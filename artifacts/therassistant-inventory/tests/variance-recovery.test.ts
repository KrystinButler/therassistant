import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateContractVariance,
  expectedAllowedForLine,
  isRecoveryAdjustment,
} from "../src/domains/ar/variance";

test("contract variance is positive only when payer allowed less than expected", () => {
  assert.equal(calculateContractVariance(10000, 8500), 1500);
  assert.equal(calculateContractVariance(10000, 10000), 0);
  assert.equal(calculateContractVariance(10000, 11500), 0);
});

test("expected allowed matches CPT and modifier and respects units", () => {
  const schedules = [
    { cpt_code: "90834", modifier: null, rate_cents: 10000 },
    { cpt_code: "90834", modifier: "95", rate_cents: 11000 },
  ];
  assert.equal(expectedAllowedForLine({ cpt_code: "90834", modifier1: "95", units: 2 }, schedules), 22000);
  assert.equal(expectedAllowedForLine({ cpt_code: "90834", modifier1: null, units: 1 }, schedules), 10000);
  assert.equal(expectedAllowedForLine({ cpt_code: "99213", modifier1: null, units: 1 }, schedules), null);
});

test("recovery adjustments include recoupments and refund corrections only", () => {
  assert.equal(isRecoveryAdjustment("recoupment"), true);
  assert.equal(isRecoveryAdjustment("refund_correction"), true);
  assert.equal(isRecoveryAdjustment("contractual"), false);
});