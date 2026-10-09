import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  discrepancyForExpectation,
  lookupCmsMedicareEnrollment,
  lookupNppesProvider,
} from "../../artifacts/api-server/src/lib/credentialing-directory.ts";

test("NPPES lookup matches by exact NPI and returns directory observation", async () => {
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        result_count: 1,
        results: [
          {
            number: 1234567890,
            basic: {
              first_name: "SAMANTHA",
              last_name: "THOMAS",
              last_updated: "2026-10-01",
            },
            addresses: [
              {
                address_purpose: "LOCATION",
                address_1: "100 MAIN ST",
                city: "LAKEWOOD",
                state: "CO",
                postal_code: "80226",
              },
            ],
            taxonomies: [
              {
                code: "1041C0700X",
                desc: "Clinical Social Worker",
                primary: true,
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const observation = await lookupNppesProvider(
    "1234567890",
    fetchMock as typeof fetch,
  );

  assert.equal(observation.directoryStatus, "found");
  assert.equal(observation.providerNpi, "1234567890");
  assert.equal(observation.providerName, "SAMANTHA THOMAS");
  assert.equal(observation.specialtyText, "Clinical Social Worker");
  assert.match(observation.locationText ?? "", /LAKEWOOD/);
});

test("CMS PECOS lookup returns Medicare enrollment evidence by exact NPI", async () => {
  const fetchMock = async () =>
    new Response(
      JSON.stringify([
        {
          NPI: "1234567890",
          FIRST_NAME: "SAMANTHA",
          LAST_NAME: "THOMAS",
          PROVIDER_TYPE_DESC: "Clinical Social Worker",
          LINE_1_ST_ADR: "100 MAIN ST",
          CITY_NAME: "LAKEWOOD",
          STATE_CD: "CO",
          ZIP_CD: "80226",
          ENRLMT_ID: "E12345",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const observation = await lookupCmsMedicareEnrollment(
    "1234567890",
    fetchMock as typeof fetch,
  );

  assert.equal(observation.sourceKey, "cms_pecos_ffs");
  assert.equal(observation.directoryStatus, "found");
  assert.equal(observation.providerNpi, "1234567890");
  assert.equal(observation.providerName, "SAMANTHA THOMAS");
  assert.equal(observation.specialtyText, "Clinical Social Worker");
  assert.match(observation.locationText ?? "", /LAKEWOOD/);
  assert.equal(observation.networkText, "Active Medicare FFS enrollment evidence found");
});

test("missing expected listing creates credentialing discrepancy only", () => {
  const discrepancy = discrepancyForExpectation({
    expectedParticipation: true,
    observation: {
      sourceKey: "payer-example",
      sourceRecordId: null,
      directoryStatus: "not_found",
      providerNpi: "1234567890",
      providerName: null,
      specialtyText: null,
      locationText: null,
      networkText: null,
      sourceUpdatedAt: null,
      checkedAt: new Date().toISOString(),
      rawResult: {},
    },
  });

  assert.deepEqual(discrepancy, {
    type: "expected_not_found",
    summary: "Provider is expected in this directory but was not found.",
  });
});

test("claim and charge API routes have no credentialing dependency", async () => {
  const [claimsRoute, chargesRoute] = await Promise.all([
    readFile("artifacts/api-server/src/routes/claims.ts", "utf8"),
    readFile("artifacts/api-server/src/routes/charges.ts", "utf8"),
  ]);

  for (const source of [claimsRoute, chargesRoute]) {
    assert.doesNotMatch(source, /provider_payer_enrollments/i);
    assert.doesNotMatch(source, /credentialing_directory/i);
    assert.doesNotMatch(source, /credentialing/i);
  }
});

test("directory monitor schema is part of clean Supabase replay", async () => {
  const migration = await readFile(
    "supabase/migrations/20261006232853_credentialing_directory_monitor.sql",
    "utf8",
  );

  for (const table of [
    "credentialing_directory_expectations",
    "credentialing_directory_snapshots",
    "credentialing_directory_discrepancies",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /private\.has_tenant_read_access/);
  assert.match(migration, /private\.has_tenant_write_access/);
  assert.doesNotMatch(migration, /professional_claims|provider_payer_enrollments/i);
});

test("claim validation migration removes provider enrollment lookup", async () => {
  const migration = await readFile(
    "lib/db/migrations/20261006_credentialing_directory_monitor.sql",
    "utf8",
  );
  const functionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.rcm_validate_claim");
  assert.notEqual(functionStart, -1);
  const claimFunction = migration.slice(functionStart);

  assert.doesNotMatch(claimFunction, /provider_payer_enrollments/i);
  assert.doesNotMatch(claimFunction, /credentialing_directory/i);
});

test("Care Compare is not used as a Medicare enrollment source", async () => {
  const [adapter, medicareRoute] = await Promise.all([
    readFile("artifacts/api-server/src/lib/credentialing-directory.ts", "utf8"),
    readFile("artifacts/api-server/src/routes/credentialing-medicare.ts", "utf8"),
  ]);

  assert.doesNotMatch(adapter, /care compare/i);
  assert.doesNotMatch(medicareRoute, /care compare/i);
  assert.match(adapter, /cms_pecos_ffs/);
  assert.match(medicareRoute, /CMS PECOS Medicare Fee-for-Service Public Provider Enrollment/);
});
