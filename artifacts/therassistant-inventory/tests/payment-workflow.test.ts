import test from "node:test";
import assert from "node:assert/strict";

import {
  createDenialFromAdjudicationWorkflow,
  import835Workflow,
  postInsurancePaymentWorkflow,
  validateAllocation,
  type EraImportRepository,
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
      metadata: {},
    }],
  ]);
  const claimLines = new Map<string, Row[]>([
    ["claim-1", [{
      id: "claim-line-1",
      claim_id: "claim-1",
      service_date: "2026-09-01",
      cpt_code: "90837",
      charge_amount_cents: 10000,
    }]],
  ]);
  const payments: Row[] = [];
  const allocations: Row[] = [];
  const adjustments: Row[] = [];
  const adjustmentAllocations: Row[] = [];
  const eraFiles: Row[] = [];
  const eraClaims: Row[] = [];
  const eraMatches: Row[] = [];
  const eraServiceLines: Row[] = [];
  const denials: Row[] = [];
  const workItems: Row[] = [];
  const appeals: Row[] = [];
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const repo: EraImportRepository = {
    async getClaim(claimId) { return claims.get(claimId) ?? null; },
    async findClaimsByPatientControlNumber(control) {
      return [...claims.values()].filter((row) => row.patient_control_number === control);
    },
    async getClaimLines(claimId) { return claimLines.get(claimId) ?? []; },
    async getEraFileByTrace(traceNumber) {
      return eraFiles.find((row) => row.check_or_trace_number === traceNumber) ?? null;
    },
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
    async createEraServiceLine(values) { const row = { id: id("era-line"), ...values }; eraServiceLines.push(row); return row; },
    async updateEraFile(eraFileId, values) {
      const index = eraFiles.findIndex((row) => row.id === eraFileId);
      if (index < 0) throw new Error("ERA file not found");
      eraFiles[index] = { ...eraFiles[index], ...values };
      return eraFiles[index];
    },
    async updateEraClaim(eraClaimId, values) {
      const index = eraClaims.findIndex((row) => row.id === eraClaimId);
      if (index < 0) throw new Error("ERA claim not found");
      eraClaims[index] = { ...eraClaims[index], ...values };
      return eraClaims[index];
    },
    async updateClaim(claimId, values) {
      const current = claims.get(claimId);
      if (!current) throw new Error("Claim not found");
      const updated = { ...current, ...values };
      claims.set(claimId, updated);
      return updated;
    },
    async createDenial(values) { const row = { id: id("denial"), ...values }; denials.push(row); return row; },
    async upsertWorkItem(values) {
      const existing = workItems.find((row) =>
        row.workqueue_type === values.workqueue_type &&
        row.source_object_type === values.source_object_type &&
        row.source_object_id === values.source_object_id &&
        ["open", "in_progress", "pending", "snoozed", "reopened"].includes(String(row.workqueue_status)),
      );
      if (existing) {
        Object.assign(existing, values);
        return existing;
      }
      const row = { id: id("work"), ...values };
      workItems.push(row);
      return row;
    },
  };

  return {
    repo,
    claims,
    claimLines,
    payments,
    allocations,
    adjustments,
    adjustmentAllocations,
    eraFiles,
    eraClaims,
    eraMatches,
    eraServiceLines,
    denials,
    workItems,
    appeals,
  };
}

function era835({
  trace = "TRACE-1001",
  control = "TH-1001",
  status = "1",
  charge = "100.00",
  paid = "75.00",
  patient = "10.00",
  cas = ["CAS*CO*45*15.00", "CAS*PR*1*10.00"],
  remarks = [] as string[],
}: Partial<{
  trace: string;
  control: string;
  status: string;
  charge: string;
  paid: string;
  patient: string;
  cas: string[];
  remarks: string[];
}> = {}) {
  return [
    "ST*835*0001",
    `BPR*I*${paid}*C*ACH*CCP************20260920`,
    `TRN*1*${trace}`,
    "N1*PR*AETNA",
    "N1*PE*EXAMPLE BEHAVIORAL HEALTH",
    `CLP*${control}*${status}*${charge}*${paid}*${patient}**PAYER-1001*11*1`,
    "NM1*QC*1*PATIENT*DEMO",
    `SVC*HC:90837*${charge}*${paid}`,
    "DTM*472*20260901",
    ...cas,
    ...remarks,
    "SE*12*0001",
  ].join("~") + "~";
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

test("real 835 import posts payment, contractual adjustment, and patient responsibility", async () => {
  const state = makeRepo();
  const result = await import835Workflow(state.repo, {
    rawText: era835(),
    fileName: "aetna-20260920.835",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.matchedCount, 1);
  assert.equal(result.value.postedCount, 1);
  assert.equal(result.value.exceptionCount, 0);
  assert.equal(state.eraFiles[0].status, "posted");
  assert.equal(state.eraClaims[0].status, "posted");
  assert.equal(state.eraMatches[0].match_status, "matched");
  assert.equal(state.eraServiceLines[0].claim_line_id, "claim-line-1");
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].amount_cents, 7500);
  assert.equal(state.payments[0].payment_status, "posted");
  assert.equal(state.allocations[0].amount_cents, 7500);
  assert.equal(state.adjustments[0].adjustment_type, "contractual");
  assert.equal(state.adjustments[0].amount_cents, 1500);
  assert.equal(state.claims.get("claim-1")?.claim_status, "patient_responsibility");
  assert.equal(state.claims.get("claim-1")?.metadata.patient_responsibility_cents, 1000);
});

test("duplicate 835 trace is blocked before financial posting", async () => {
  const state = makeRepo();
  const rawText = era835({ trace: "DUPLICATE-TRACE" });
  const first = await import835Workflow(state.repo, { rawText, fileName: "first.835" });
  const second = await import835Workflow(state.repo, { rawText, fileName: "second.835" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(state.eraFiles.length, 1);
  assert.equal(state.payments.length, 1);
});

test("unmatched 835 claim is retained for review and payment remains unapplied", async () => {
  const state = makeRepo();
  const result = await import835Workflow(state.repo, {
    rawText: era835({ control: "UNKNOWN-CLAIM", trace: "UNMATCHED-1" }),
    fileName: "unmatched.835",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.matchedCount, 0);
  assert.equal(result.value.postedCount, 0);
  assert.ok(result.value.exceptionCount > 0);
  assert.equal(state.eraClaims[0].status, "unmatched");
  assert.equal(state.eraMatches[0].match_status, "unmatched");
  assert.equal(state.payments[0].payment_status, "unapplied");
  assert.ok(state.workItems.some((row) => row.workqueue_type === "unmatched_era"));
});

test("unsupported 835 adjustment group does not auto-write off claim", async () => {
  const state = makeRepo();
  const result = await import835Workflow(state.repo, {
    rawText: era835({
      trace: "OA-REVIEW",
      paid: "70.00",
      patient: "0.00",
      cas: ["CAS*CO*45*20.00", "CAS*OA*23*10.00"],
    }),
    fileName: "oa-review.835",
  });

  assert.equal(result.ok, true);
  assert.equal(state.adjustments.length, 0);
  assert.equal(state.claims.get("claim-1")?.claim_status, "accepted");
  assert.ok(state.workItems.some((row) => row.workqueue_type === "payment_posting_issue"));
  assert.equal(state.payments[0].payment_status, "unapplied");
});

test("CLP status 4 creates denial from actual 835 codes without auto appeal", async () => {
  const state = makeRepo();
  const result = await import835Workflow(state.repo, {
    rawText: era835({
      trace: "DENIAL-835",
      status: "4",
      paid: "0.00",
      patient: "0.00",
      cas: ["CAS*CO*197*100.00"],
      remarks: ["LQ*HE*N130"],
    }),
    fileName: "denial.835",
  });

  assert.equal(result.ok, true);
  assert.equal(state.denials.length, 1);
  assert.equal(state.denials[0].carc_code, "197");
  assert.equal(state.denials[0].rarc_code, "N130");
  assert.equal(state.claims.get("claim-1")?.claim_status, "denied");
  assert.ok(state.workItems.some((row) => row.workqueue_type === "denial_followup"));
  assert.equal(state.appeals.length, 0);
});

test("denied adjudication helper creates denial and follow-up work without auto appeal", async () => {
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
