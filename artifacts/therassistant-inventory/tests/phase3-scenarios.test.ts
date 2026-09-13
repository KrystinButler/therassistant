import test from "node:test";
import assert from "node:assert/strict";

import { phase3BillingScenarios } from "../src/domains/demo/phase3-scenarios.ts";

test("Phase 3 demo covers advanced billing and recovery workflows", () => {
  assert.deepEqual(
    phase3BillingScenarios.map((scenario) => scenario.code),
    [
      "claim_rejection_resubmission",
      "denial_appeal",
      "contract_underpayment",
      "recoupment_recovery",
      "unapplied_payment_reversal",
      "credentialing_writeoff",
    ],
  );
  assert.equal(phase3BillingScenarios.every((scenario) => scenario.synthetic === true), true);
  assert.equal(phase3BillingScenarios.every((scenario) => scenario.demoId.startsWith("P3-")), true);
  assert.equal(new Set(phase3BillingScenarios.map((scenario) => scenario.demoId)).size, 6);
});