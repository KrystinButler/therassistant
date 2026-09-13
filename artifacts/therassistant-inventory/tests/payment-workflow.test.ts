import test from "node:test";
import assert from "node:assert/strict";

import {
  createDenialFromAdjudicationWorkflow,
  postDemoEraWorkflow,
  postInsurancePaymentWorkflow,
  validateAllocation,
  type PaymentRepository,
} from "../src/domains/payments/workflow.ts";

type Row = Record<string, any> & { id: string };

function makeRepo() {
  const claims = new Map<string, Row>([
    ["claim-1", {
      id: "claim-1",
      claim_status: "accepted",
      client_id: "client-1",
      payer_id: "payer-1",
      total_charge_cents: 10000,
      patient_control_number: "TH-1001",
    }],
  ]);
  const payments: Row[] = [];
  const allocations: Row[] = [];
  const adjustments: Row[] = [];
  const adjustmentAllocations: Row[] = [];
  const eraFiles: Row[] = [];
  const eraClaims: Row[] = [];
  const eraMatches: Row[] = [];
  const denials: Row[] = [];
  const workItems: Row[] = [];
  const appeals: Row[] = [];
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const repo: PaymentRepository = {
    async getClaim(claimId) { return claims.get(claimId) ?? null; },
    async createPayment(values) { const row = { id: id("payment"), ...values }; payments.push(row); return row; },
    async updatePayment(paymentId, values) {
      const index = payments.findIndex((row) => row.id === paymentId);
      if (index < 0) throw new Error("Payment not found");
      payments[index] = { ...payments[index], ...values };
      return payments[index];
    },
    async createPaymentAllocation(values) { const row = { id: id("alloc"), ...values }; allocations.push(row); return row; },
    async createAdjustment(values) { const row = { id: id("adjustment"), ...values }; adjustments.push(row); return row; },
    async createAdjustmentAllocation(values) { const row = { id: id("adj-alloc"), ...values }; adjustmentAllocations.push(row); return row; },
    async createEraFile(values) { const row = { id: id("era-file"), ...values }; eraFiles.push(row); return row; },
    async createEraClaim(values) { const row = { id: id("era-claim"), ...values }; eraClaims.push(row); return row; },
    async createEraMatch(values) { const row = { id: id("era-match"), ...values }; eraMatches.push(row); return row; },
    async updateEraFile(eraFileId, values) {
      const index = eraFiles.findIndex((row) => row.id === eraFileId);
      if (index < 0) throw new Error("ERA file not found");
      eraFiles[index] = { ...eraFiles[index], ...values };
      return eraFiles[index];
    },
    async updateClaim(claimId, values) {
      const current = claims.get(claimId);
      if (!current) throw new Error("Claim not found");
      const updated = { ...current, ...values };
      claims.set(claimId, updated);
      return updated;
    },
    async createDenial(values) { const row = { id: id("denial"), ...values }; denials.push(row); return row; },
    async upsertWorkItem(values) { const row = { id: id("work"), ...values }; workItems.push(row); return row; },
  };

  return {
    repo,
    claims,
    payments,
    allocations,
    adjustments,
    adjustmentAllocations,
    eraFiles,
    eraClaims,
    eraMatches,
    denials,
    workItems,
    appeals,
  };
}

test("payment allocations must reconcile to payment amount", () => {
  assert.throws(() => validateAllocation(10000, [7000, 4000], 0), /exceed/i);
  assert.doesNotThrow(() => validateAllocation(10000, [7000, 2000], 1000));
  assert.throws(() => validateAllocation(10000, [7000, 2000], 0), /reconcile/i);
});

test("fully allocated insurance payment is posted", async () => {
  const state = makeRepo();
  const result = await postInsurancePaymentWorkflow(state.repo, {
    claimId: "claim-1",
    amountCents: 8000,
    allocations: [{ claimId: "claim-1", amountCents: 8000 }],
    unappliedCents: 0,
    traceNumber: "EFT-1001",
  });
  assert.equal(result.ok, true);
  assert.equal(state.payments[0].payment_status, "posted");
  assert.equal(state.allocations.length, 1);
});

test("demo ERA posts payment and contractual adjustment then closes zero-balance claim", async () => {
  const state = makeRepo();
  const result = await postDemoEraWorkflow(state.repo, {
    claimId: "claim-1",
    paidAmountCents: 8000,
    adjustmentAmountCents: 2000,
    traceNumber: "ERA-1001",
    carcCode: "45",
  });

  assert.equal(result.ok, true);
  assert.equal(state.eraFiles.length, 1);
  assert.equal(state.eraClaims.length, 1);
  assert.equal(state.eraMatches.length, 1);
  assert.equal(state.payments.length, 1);
  assert.equal(state.allocations[0].amount_cents, 8000);
  assert.equal(state.adjustments[0].adjustment_type, "contractual");
  assert.equal(state.adjustmentAllocations[0].amount_cents, 2000);
  assert.equal(state.claims.get("claim-1")?.claim_status, "paid");
});

test("denied adjudication creates denial and follow-up work without auto appeal", async () => {
  const state = makeRepo();
  const result = await createDenialFromAdjudicationWorkflow(state.repo, {
    claimId: "claim-1",
    amountCents: 10000,
    carcCode: "197",
    rarcCode: "N130",
    category: "authorization",
    reason: "Authorization required for service.",
    workability: "workable",
  });

  assert.equal(result.ok, true);
  assert.equal(state.denials.length, 1);
  assert.equal(state.workItems.length, 1);
  assert.equal(state.workItems[0].workqueue_type, "denial_followup");
  assert.equal(state.claims.get("claim-1")?.claim_status, "denied");
  assert.equal(state.appeals.length, 0);
});
