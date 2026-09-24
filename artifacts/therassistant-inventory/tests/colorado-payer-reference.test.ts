import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLORADO_RAE_REGIONS, getColoradoPayerProfile, getColoradoReferenceResources, listedColoradoPayerNames } from "../src/domains/credentialing/colorado-payer-reference";

test("all 16 starter payers have an official Colorado reference without tenant setup", () => {
  const names = ["Aetna","Anthem Blue Cross Blue Shield","Blue Cross Blue Shield","Carelon Behavioral Health","Cigna","Colorado Access","Colorado Community Health Alliance","Denver Health Medical Plan","Health First Colorado","Medicaid","Medicare","Northeast Health Partners","Optum","Rocky Mountain Health Plans","TRICARE","UnitedHealthcare"];
  assert.equal(listedColoradoPayerNames().length, 16);
  for (const name of names) {
    assert.ok(getColoradoPayerProfile(name), name);
    const resources = getColoradoReferenceResources("payer-1", name);
    assert.ok(resources.length > 0, name);
    assert.ok(resources.every((r) => /^https:\/\//.test(r.url)));
    assert.ok(resources.every((r) => r.verification_status === "reference" && r.resource_type !== "billing_rule"));
  }
});

test("Colorado phase III RAEs are distinct from Denver Health Medicaid Choice MCO", () => {
  assert.deepEqual(COLORADO_RAE_REGIONS.map((r) => r.name), ["Rocky Mountain Health Plans","Northeast Health Partners","Colorado Community Health Alliance","Colorado Access"]);
  assert.deepEqual(COLORADO_RAE_REGIONS.map((r) => getColoradoPayerProfile(r.name)?.region), [1,2,3,4]);
  assert.equal(getColoradoPayerProfile("Denver Health Medical Plan")?.category, "mco");
  assert.match(getColoradoPayerProfile("Blue Cross Blue Shield")?.note ?? "", /Generic BCBS/);
  assert.equal(getColoradoPayerProfile("Unknown"), null);
});

test("preloaded payer reference flows into list, payer detail and in-task guidance without fictional contracts", () => {
  const page = readFileSync(new URL("../src/domains/credentialing/PayersContractsPage.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../src/pages/payer-detail.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/payer-intelligence-panel.tsx", import.meta.url), "utf8");
  assert.match(page, /getColoradoReferenceResources/);
  assert.match(page, /COLORADO_RAE_REGIONS/);
  assert.doesNotMatch(page, /tenantInsert|Save Contract|newContractPayer/);
  assert.match(detail, /bundledReferences/);
  assert.match(panel, /getColoradoReferenceResources/);
});
