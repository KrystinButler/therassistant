import test from "node:test";
import assert from "node:assert/strict";

import {
  isVerifiedEligibilitySource,
  parseEligibilityBenefits,
} from "../src/domains/eligibility/workflow.ts";

test("synthetic demo eligibility is never treated as verified coverage", () => {
  assert.equal(isVerifiedEligibilitySource("synthetic_demo_270_271"), false);
  assert.equal(isVerifiedEligibilitySource("manual_payer_portal"), true);
  assert.equal(isVerifiedEligibilitySource("manual_payer_phone"), true);
  assert.equal(isVerifiedEligibilitySource("clearinghouse_271"), true);
  assert.equal(isVerifiedEligibilitySource(""), false);
});

test("payer-confirmed manual benefits parse into usable fields", () => {
  const raw = {
    manual: true,
    verification_source: "payer_portal",
    benefits: {
      copay_cents: 2000,
      coinsurance_percent: 20,
      deductible_cents: 150000,
      deductible_remaining_cents: 75000,
      out_of_pocket_cents: 500000,
      out_of_pocket_remaining_cents: 325000,
      network_status: "in_network",
      authorization_required: false,
    },
  };
  const benefits = parseEligibilityBenefits(raw);

  assert.equal(benefits.copayCents, 2000);
  assert.equal(benefits.coinsurancePercent, 20);
  assert.equal(benefits.deductibleCents, 150000);
  assert.equal(benefits.networkStatus, "in_network");
  assert.equal(benefits.authorizationRequired, false);
});

test("missing benefit fields do not invent coverage amounts", () => {
  const benefits = parseEligibilityBenefits({
    manual: true,
    verification_source: "payer_phone",
    benefits: {},
  });
  assert.equal(benefits.copayCents, null);
  assert.equal(benefits.deductibleRemainingCents, null);
  assert.equal(benefits.networkStatus, "unknown");
});
