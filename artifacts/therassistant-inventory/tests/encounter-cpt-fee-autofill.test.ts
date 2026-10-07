import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/domains/encounters/EncounterPage.tsx"), "utf8");
const repository = readFileSync(join(here, "../src/domains/encounters/repository.ts"), "utf8");

test("selecting a CPT or HCPCS code resolves and populates the encounter charge", () => {
  assert.match(repository, /export async function getEncounterServiceFee/);
  assert.match(repository, /tenantSelect<[^>]+>\("v_fee_schedule_rates"/);
  assert.match(repository, /referenceSelect<[^>]+>\("v_reference_fee_rates"/);
  assert.match(repository, /Prescriber-Level/);
  assert.match(repository, /Masters-Level/);

  assert.match(page, /getEncounterServiceFee/);
  assert.match(page, /onSelect=\{async \(result\) =>/);
  assert.match(page, /setServiceCode\(result\.code\)/);
  assert.match(page, /setChargeDollars\([^)]*rateCents[^)]*\/\s*100/);
});
