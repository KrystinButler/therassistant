import test from "node:test";
import assert from "node:assert/strict";

import {
  syntheticEligibilityStatus,
  buildSyntheticEligibilityResponse,
  parseEligibilityBenefits,
} from "../src/domains/eligibility/workflow.ts";

test("synthetic eligibility supports active, inactive and unable-to-verify outcomes", () => {
  assert.equal(syntheticEligibilityStatus("MEM123"), "active");
  assert.equal(syntheticEligibilityStatus("MEM120"), "inactive");
  assert.equal(syntheticEligibilityStatus("MEM129"), "unable_to_verify");
});

test("active synthetic 271 contains usable benefit fields", () => {
  const raw = buildSyntheticEligibilityResponse("MEM123", "active");
  const benefits = parseEligibilityBenefits(raw);

  assert.equal(raw.transaction, "271");
  assert.equal(benefits.copayCents, 2000);
  assert.equal(benefits.coinsurancePercent, 20);
  assert.equal(benefits.deductibleCents, 150000);
  assert.equal(benefits.networkStatus, "in_network");
  assert.equal(benefits.authorizationRequired, false);
});

test("non-active eligibility does not invent active benefits", () => {
  const raw = buildSyntheticEligibilityResponse("MEM120", "inactive");
  const benefits = parseEligibilityBenefits(raw);
  assert.equal(benefits.copayCents, null);
  assert.equal(benefits.networkStatus, "unknown");
});
