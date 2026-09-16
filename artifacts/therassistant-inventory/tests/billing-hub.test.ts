import test from "node:test";
import assert from "node:assert/strict";

import { buildBillingHubSummary } from "../src/domains/billing/hub";

test("billing hub summarizes actionable financial work by canonical owner", () => {
  const summary = buildBillingHubSummary({
    charges: [{ charge_status: "ready_for_claim", charge_amount_cents: 12000 }],
    claims: [
      { claim_status: "rejected", total_charge_cents: 12000 },
      { claim_status: "denied", total_charge_cents: 9000 },
      { claim_status: "accepted", total_charge_cents: 15000 },
    ],
    payments: [{ payment_status: "unapplied", amount_cents: 8000 }],
    denials: [
      { denial_status: "new", amount_cents: 12000 },
      { denial_status: "upheld", amount_cents: 4000 },
      { denial_status: "resolved_writeoff", amount_cents: 3000 },
    ],
    appeals: [{ appeal_status: "drafting" }],
    insuranceAr: [
      { claim_status: "accepted", openBalanceCents: 12000 },
      { claim_status: "rejected", openBalanceCents: 7000 },
      { claim_status: "denied", openBalanceCents: 6000 },
    ],
    patientAr: [{ openBalanceCents: 2500 }],
    variances: [{ varianceCents: 1500 }],
    recoveryItems: [{ amount_cents: 3000 }],
  });

  assert.deepEqual(summary.readyCharges, { count: 1, amountCents: 12000 });
  assert.deepEqual(summary.claimsNeedAction, { count: 1, amountCents: 12000 });
  assert.deepEqual(summary.unappliedPayments, { count: 1, amountCents: 8000 });
  assert.deepEqual(summary.insuranceAr, { count: 1, amountCents: 12000 });
  assert.deepEqual(summary.patientAr, { count: 1, amountCents: 2500 });
  assert.deepEqual(summary.denials, { count: 2, amountCents: 16000 });
  assert.deepEqual(summary.appeals, { count: 1, amountCents: 0 });
  assert.deepEqual(summary.underpayments, { count: 1, amountCents: 1500 });
  assert.deepEqual(summary.recovery, { count: 1, amountCents: 3000 });
});
