import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  discrepancyForExpectation,
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
