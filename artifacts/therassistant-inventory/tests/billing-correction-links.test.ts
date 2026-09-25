import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billingCorrectionLink, billingCorrectionLinks } from "../src/domains/billing/billing-correction-links";

test("billing readiness corrections link to actual editable encounter sections", () => {
  const id = "encounter-1";
  assert.equal(billingCorrectionLink({ code: "diagnosis_missing" }, id)?.href, "/encounters/encounter-1#encounter-diagnoses");
  assert.equal(billingCorrectionLink({ check_code: "service_line_incomplete" }, id)?.href, "/encounters/encounter-1#encounter-coding-service");
  assert.equal(billingCorrectionLink({ code: "note_unsigned" }, id)?.href, "/encounters/encounter-1#encounter-signature");
  assert.equal(billingCorrectionLink({ message: "Eligibility is not verified" }, id, "client-1")?.href, "/clients/client-1?tab=coverage");
  assert.equal(billingCorrectionLink({ message: "A Supabase request failed (403)" }, id), null);
});
test("correction links deduplicate repeated failures without losing distinct fields", () => {
  const links = billingCorrectionLinks([{ code: "diagnosis_missing" }, { message: "No diagnosis" }, { code: "service_line_missing" }], "one");
  assert.equal(links.length, 2);
});
test("charge errors, queue checks and encounter targets are connected end to end", () => {
  const billing = readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx", import.meta.url), "utf8");
  const encounter = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");
  const rejections = readFileSync(new URL("../src/domains/claims/RejectionsPage.tsx", import.meta.url), "utf8");
  assert.match(billing, /BillingCorrectionActions/);
  assert.match(billing, /rejections\?claim=/);
  for (const target of ["encounter-signature", "encounter-diagnoses", "encounter-coding-service"]) assert.ok(encounter.includes('id="' + target + '"'));
  assert.equal(billingCorrectionLink({code:"funding_missing"}, "one")?.href, "/billing/charges?tab=blocked&encounter=one");
  assert.match(rejections, /new URLSearchParams\(window\.location\.search\)\.get\("claim"\)/);
});
