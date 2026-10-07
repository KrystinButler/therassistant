import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cignaCanonicalPlanKey,
  insurancePlanProduct,
  isColoradoInsurancePlan,
  resolveCignaNetworkNames,
} from "../../supabase/functions/_shared/credentialing/cigna-catalog.ts";

const adapterPath = "supabase/functions/_shared/credentialing/cigna.ts";
const catalogPath = "supabase/functions/credentialing-catalog-sync/index.ts";
const catalogResumeMigrationPath = "supabase/migrations/20261007050000_credentialing_catalog_sync_resume.sql";
const workerPath = "supabase/functions/credentialing-verification-worker/processor.ts";

async function text(path: string) {
  return readFile(path, "utf8");
}

test("Cigna verifier uses exact NPI plus PractitionerRole network relationship", async () => {
  const adapter = await text(adapterPath);
  assert.match(adapter, /Practitioner\?identifier=/);
  assert.match(adapter, /PractitionerRole\?/);
  assert.match(adapter, /network=/);
  assert.match(adapter, /providerNetworkRelationshipConfirmed/);
  assert.match(adapter, /http:\/\/hl7\.org\/fhir\/sid\/us-npi/);
  assert.doesNotMatch(adapter, /providerNetworkRelationshipConfirmed:\s*true[\s\S]{0,100}Practitioner\?identifier/);
});

test("Cigna selected group and location evidence are checked when supplied", async () => {
  const adapter = await text(adapterPath);
  assert.match(adapter, /organizationNpi/);
  assert.match(adapter, /Organization\?identifier=/);
  assert.match(adapter, /postalCode/);
  assert.match(adapter, /_include=PractitionerRole%3Alocation|_include.*PractitionerRole:location/);
});

test("Cigna catalog recognizes Colorado when coverageArea uses direct display instead of a Location reference", () => {
  const plan = {
    resourceType: "InsurancePlan" as const,
    id: "d16-example",
    name: "Open Access Plus",
    coverageArea: [{ display: "CO" }],
    type: [
      {
        coding: [
          {
            code: "commppo",
            display: "Commercial PPO",
          },
        ],
      },
    ],
    network: [{ reference: "Organization/d16-network" }],
  };

  assert.equal(isColoradoInsurancePlan(plan, new Map()), true);
  assert.deepEqual(insurancePlanProduct(plan), {
    code: "commppo",
    display: "Commercial PPO",
  });
});

test("Cigna catalog still recognizes referenced Colorado coverage locations", () => {
  const plan = {
    resourceType: "InsurancePlan" as const,
    id: "referenced-location-plan",
    name: "Referenced Location Plan",
    coverageArea: [{ reference: "Location/co-location" }],
  };
  const locations = new Map([
    [
      "co-location",
      {
        resourceType: "Location" as const,
        id: "co-location",
        address: { state: "CO" },
      },
    ],
  ]);

  assert.equal(isColoradoInsurancePlan(plan, locations), true);
});

test("Cigna canonical plan key collapses duplicate source records with the same normalized name and product", () => {
  assert.equal(
    cignaCanonicalPlanKey(" Open Access Plus ", "commppo"),
    cignaCanonicalPlanKey("open access plus", "COMM PPO"),
  );
  assert.notEqual(
    cignaCanonicalPlanKey("Open Access Plus", "commppo"),
    cignaCanonicalPlanKey("Open Access Plus", "commhmo"),
  );
});

test("Cigna network-name resolver deduplicates network lookups and preserves existing cache", async () => {
  const calls: string[] = [];
  const cache = new Map<string, string | null>([["existing", "Existing Network"]]);
  const resolved = await resolveCignaNetworkNames(
    ["existing", "network-a", "network-a", "network-b"],
    cache,
    async (id) => {
      calls.push(id);
      return id === "network-a" ? "Network A" : null;
    },
    2,
  );

  assert.deepEqual(calls.sort(), ["network-a", "network-b"]);
  assert.equal(resolved.get("existing"), "Existing Network");
  assert.equal(resolved.get("network-a"), "Network A");
  assert.equal(resolved.get("network-b"), null);
});

test("Cigna catalog uses a supported page size and rejects OperationOutcome bundles", async () => {
  const catalog = await text(catalogPath);
  assert.match(catalog, /InsurancePlan\?_count=50/);
  assert.match(catalog, /OperationOutcome/);
  assert.match(catalog, /Cigna Provider Directory returned an OperationOutcome/);
  assert.doesNotMatch(catalog, /InsurancePlan\?_count=200/);
});

test("Cigna catalog sync is bounded, resumable, and does not restart a fresh completed catalog all day", async () => {
  const [catalog, migration] = await Promise.all([
    text(catalogPath),
    text(catalogResumeMigrationPath),
  ]);
  assert.match(migration, /next_cursor_url/);
  assert.match(migration, /pages_processed/);
  assert.match(migration, /last_progress_at/);
  assert.match(migration, /\*\/15 \* \* \* \*/);
  assert.match(catalog, /MAX_PAGES_PER_INVOCATION\s*=\s*1/);
  assert.match(catalog, /CATALOG_REFRESH_INTERVAL_MS/);
  assert.match(catalog, /next_cursor_url/);
  assert.match(catalog, /last_progress_at/);
  assert.match(catalog, /status=eq\.in_progress/);
});

test("Cigna catalog sync resolves unique network names before persisting plan-network rows", async () => {
  const catalog = await text(catalogPath);
  assert.match(catalog, /resolveCignaNetworkNames/);
  assert.match(catalog, /networkNameCache/);
  assert.match(catalog, /saveNetworks/);
  assert.match(catalog, /external_network_id/);
});

test("Cigna catalog reuses canonical plan rows when source IDs repeat the same plan name and product", async () => {
  const catalog = await text(catalogPath);
  assert.match(catalog, /canonicalPlanCache/);
  assert.match(catalog, /cignaCanonicalPlanKey/);
  assert.match(catalog, /externalPlanCache/);
});

test("Cigna catalog sync derives plans and networks from InsurancePlan references", async () => {
  const catalog = await text(catalogPath);
  assert.match(catalog, /InsurancePlan/);
  assert.match(catalog, /external_plan_id/);
  assert.match(catalog, /external_network_id/);
  assert.match(catalog, /payer_catalog_syncs/);
  assert.match(catalog, /adapter_key=eq\.cigna/);
  assert.match(catalog, /isColoradoInsurancePlan/);
  assert.match(catalog, /insurancePlanProduct/);
});

test("verification worker dispatches Cigna through the Plan-Net adapter", async () => {
  const worker = await text(workerPath);
  assert.match(worker, /verifyCignaParticipation/);
  assert.match(worker, /adapterKey === "cigna"/);
  assert.match(worker, /PARTICIPATING/);
  assert.match(worker, /NOT_FOUND/);
});
