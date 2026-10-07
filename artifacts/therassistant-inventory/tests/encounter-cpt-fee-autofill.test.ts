import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const searchInput = readFileSync(join(here, "../src/domains/coding/ProcedureCodeSearchInput.tsx"), "utf8");
const repository = readFileSync(join(here, "../src/domains/encounters/repository.ts"), "utf8");

test("opening or selecting a CPT or HCPCS code resolves and populates the encounter charge", () => {
  assert.match(repository, /export async function getEncounterServiceFee/);
  assert.match(repository, /tenantSelect<[^>]+>\("v_fee_schedule_rates"/);
  assert.match(repository, /referenceSelect<[^>]+>\("v_reference_fee_rates"/);
  assert.match(repository, /Prescriber-Level/);
  assert.match(repository, /Masters-Level/);

  assert.match(searchInput, /getEncounterServiceFee/);
  assert.match(searchInput, /encounter-charge-amount/);
  assert.match(searchInput, /populateEncounterCharge\(exactCode, serviceDate, false\)/);
  assert.match(searchInput, /populateEncounterCharge\(result\.code, serviceDate, true\)/);
  assert.match(searchInput, /rateCents\s*\/\s*100/);
  assert.match(searchInput, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
});
