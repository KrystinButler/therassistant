import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAllocationPlan,
  buildPaymentReversal,
  calculateUnapplied,
  totalPostedPayments,
  validatePaymentDraft,
} from "../src/domains/payments/operations";

test("unapplied balance equals payment less allocations", () => {
  assert.equal(calculateUnapplied(10000, [6000, 2500]), 1500);
  assert.equal(calculateUnapplied(10000, [10000]), 0);
});

test("posted payments exclude reversed and voided transactions", () => {
  assert.equal(totalPostedPayments([
    { amount_cents: 10000, payment_status: "posted" },
    { amount_cents: 5000, payment_status: "partially_applied" },
    { amount_cents: 3000, payment_status: "unapplied" },
    { amount_cents: 7000, payment_status: "reversed" },
    { amount_cents: 2500, payment_status: "voided" },
  ]), 18000);
});

test("allocation plan blocks over-allocation and derives payment status", () => {
  assert.throws(() => buildAllocationPlan(10000, [7000, 4000]));
  assert.equal(buildAllocationPlan(10000, []).status, "unapplied");
  assert.equal(buildAllocationPlan(10000, [6000]).status, "partially_applied");
  assert.equal(buildAllocationPlan(10000, [10000]).status, "posted");
});

test("payment draft requires a positive amount and a valid source", () => {
  assert.throws(() => validatePaymentDraft({ amountCents: 0, source: "insurance", method: "eft" }));
  assert.throws(() => validatePaymentDraft({ amountCents: 1000, source: "invalid", method: "eft" }));
  assert.equal(validatePaymentDraft({ amountCents: 1000, source: "patient", method: "card" }).source, "patient");
});

test("payment reversal preserves the original payment and marks allocations reversed", () => {
  const reversal = buildPaymentReversal({ paymentId: "p1", allocationIds: ["a1", "a2"], reason: "Duplicate payment" });
  assert.equal(reversal.paymentStatus, "reversed");
  assert.deepEqual(reversal.allocationIds, ["a1", "a2"]);
  assert.equal(reversal.reason, "Duplicate payment");
});
