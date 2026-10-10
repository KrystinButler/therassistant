import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const searchInput = readFileSync(join(here, "../src/domains/coding/ProcedureCodeSearchInput.tsx"), "utf8");
const repository = readFileSync(join(here, "../src/domains/encounters/repository.ts"), "utf8");
const encounterPage = readFileSync(join(here, "../src/domains/encounters/EncounterPage.tsx"), "utf8");

test("CPT selection resolves a fee and passes it through React state instead of DOM mutation", () => {
  assert.match(repository, /export async function getEncounterServiceFee/);
  assert.match(repository, /tenantSelect<[^>]+>\("v_fee_schedule_rates"/);
  assert.match(repository, /referenceSelect<[^>]+>\("v_reference_fee_rates"/);
  assert.match(repository, /Prescriber-Level/);
  assert.match(repository, /Masters-Level/);

  assert.match(searchInput, /onFeeResolved/);
  assert.match(searchInput, /getEncounterServiceFee/);
  assert.doesNotMatch(searchInput, /getElementById\("encounter-charge-amount"\)/);
  assert.doesNotMatch(searchInput, /dispatchEvent\(new Event\("input"/);

  assert.match(encounterPage, /onFeeResolved=\{\(fee, replaceExisting\) =>/);
  assert.match(encounterPage, /setChargeDollars\(\(fee\.rateCents \/ 100\)\.toFixed\(2\)\)/);
  assert.match(encounterPage, /replaceExisting\) setChargeDollars\(""\)/);
});
