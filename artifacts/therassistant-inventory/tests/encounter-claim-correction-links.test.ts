import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const repository=readFileSync(new URL("../src/domains/encounters/repository.ts",import.meta.url),"utf8");
const encounter=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
const claims=readFileSync(new URL("../src/domains/claims/ClaimsPage.tsx",import.meta.url),"utf8");
const charges=readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx",import.meta.url),"utf8");
test("encounter claim corrections open the actual claim and preserve signed note",()=>{
  assert.match(repository,/source_encounter_id: `eq\.\$\{encounterId\}`/);
  assert.match(encounter,/data\.claims\.length \? data\.claims\.map/);
  assert.match(encounter,/Correct Held Claim/);
  assert.match(encounter,/rejections\?claim=/);
  assert.match(encounter,/Corrections are made to the actual claim/);
});
test("claim and billing queues deep-link to the requested case and tab",()=>{
  assert.match(claims,/new URLSearchParams\(window\.location\.search\)\.get\("claim"\)/);
  assert.match(claims,/setActiveClaimId\(found\.id\)/);
  assert.match(charges,/new URLSearchParams\(window\.location\.search\)\.get\("tab"\)/);
  assert.match(charges,/requested === "blocked" \|\| requested === "unbatched"/);
});
