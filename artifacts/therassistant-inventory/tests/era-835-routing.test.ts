import test from "node:test";
import assert from "node:assert/strict";

import { parse835 } from "../src/domains/payments/era-835.ts";
import { buildTest835 } from "../src/domains/payments/era-835-test-fixtures.ts";

const base = {
  patientControlNumber: "TH-ROUTE-1001",
  payerIdentifier: "AETNA835",
  claimChargeCents: 10000,
  traceNumber: "ROUTE-TRACE-1001",
  serviceDate: "2026-10-01",
  cptCode: "90837",
};

test("synthetic 835 fixtures parse into the intended adjudication states", () => {
  const paid = parse835(buildTest835("paid", base));
  assert.equal(paid.traceNumber, base.traceNumber);
  assert.equal(paid.payerIdentifier, "AETNA835");
  assert.equal(paid.paymentAmountCents, 8000);
  assert.equal(paid.claims[0].claimStatusCode, "1");
  assert.deepEqual(paid.claims[0].adjustments.map((row) => [row.groupCode, row.reasonCode, row.amountCents]), [["CO", "45", 2000]]);

  const partial = parse835(buildTest835("partial_patient", { ...base, traceNumber: "ROUTE-PARTIAL" }));
  assert.equal(partial.paymentAmountCents, 7000);
  assert.equal(partial.claims[0].patientResponsibilityCents, 1000);
  assert.ok(partial.claims[0].adjustments.some((row) => row.groupCode === "PR" && row.amountCents === 1000));

  const denied = parse835(buildTest835("denied", { ...base, traceNumber: "ROUTE-DENIED" }));
  assert.equal(denied.paymentAmountCents, 0);
  assert.equal(denied.claims[0].claimStatusCode, "4");
  assert.equal(denied.claims[0].adjustments[0].reasonCode, "197");
  assert.deepEqual(denied.claims[0].remarkCodes, ["N130"]);

  const mismatch = parse835(buildTest835("payer_mismatch", { ...base, traceNumber: "ROUTE-PAYER" }));
  assert.equal(mismatch.payerIdentifier, "WRONGPAYER");

  const reversal = parse835(buildTest835("reversal", { ...base, traceNumber: "ROUTE-REVERSAL" }));
  assert.ok(reversal.claims[0].adjustments.some((row) => row.amountCents < 0));
});

import {
  import835Workflow,
  type EraImportRepository,
} from "../src/domains/payments/workflow.ts";

type Row = Record<string, any> & { id: string };

function makeRoutingRepo(options: { ambiguous?: boolean } = {}) {
  const claims = new Map<string, Row>([["claim-1", {
    id: "claim-1",
    claim_status: "accepted",
    client_id: "client-1",
    payer_id: "payer-1",
    total_charge_cents: 10000,
    patient_control_number: base.patientControlNumber,
    metadata: {},
  }]]);
  if (options.ambiguous) {
    claims.set("claim-2", {
      ...claims.get("claim-1"),
      id: "claim-2",
      client_id: "client-2",
    });
  }
  const claimLines = new Map<string, Row[]>([["claim-1", [{
    id: "line-1",
    claim_id: "claim-1",
    service_date: base.serviceDate,
    cpt_code: base.cptCode,
    charge_amount_cents: 10000,
  }]]]);
  const payments: Row[] = [];
  const allocations: Row[] = [];
  const adjustments: Row[] = [];
  const eraFiles: Row[] = [];
  const eraClaims: Row[] = [];
  const eraMatches: Row[] = [];
  const eraServiceLines: Row[] = [];
  const denials: Row[] = [];
  const workItems: Row[] = [];
  const writeoffs: Row[] = [];
  let sequence = 1;
  const nextId = (prefix: string) => `${prefix}-${sequence++}`;

  const repo: EraImportRepository = {
    async getClaim(id) { return claims.get(id) ?? null; },
    async findClaimsByPatientControlNumber(control) {
      return [...claims.values()].filter((row) => row.patient_control_number === control);
    },
    async getClaimLines(id) { return claimLines.get(id) ?? []; },
    async getEraFileByTrace(trace) {
      return eraFiles.find((row) => row.check_or_trace_number === trace) ?? null;
    },
    async getExpectedEraPayerIdentifier(payerId) {
      return payerId === "payer-1" ? base.payerIdentifier : null;
    },
    async postEraPaymentReceipt(input) {
      const row: Row = {
        id: nextId("payment"),
        payer_id: input.payerId,
        amount_cents: input.amountCents,
        payment_method: input.method,
        payment_date: input.paymentDate,
        trace_number: input.traceNumber,
        payment_status: "unapplied",
        notes: input.notes,
      };
      payments.push(row);
      return row;
    },
    async allocatePayment(paymentId, claimId, amountCents) {
      const payment = payments.find((row) => row.id === paymentId);
      const claim = claims.get(claimId);
      if (!payment || !claim) throw new Error("Payment or claim missing");
      const row: Row = {
        id: nextId("allocation"),
        payment_id: paymentId,
        claim_id: claimId,
        client_id: claim.client_id,
        amount_cents: amountCents,
      };
      allocations.push(row);
      payment.payment_status = "posted";
      return { allocation_cents: amountCents, unapplied_cents: 0, payment_status: "posted" };
    },
    async postContractualAdjustment(input) {
      const row: Row = { id: nextId("adjustment"), ...input, adjustment_type: "contractual" };
      adjustments.push(row);
      return row;
    },
    async createPayment(values) { const row: Row = { id: nextId("payment"), ...values }; payments.push(row); return row; },
    async updatePayment(id, values) {
      const row = payments.find((item) => item.id === id);
      if (!row) throw new Error("Payment missing");
      Object.assign(row, values);
      return row;
    },
    async createPaymentAllocation(values) { const row: Row = { id: nextId("allocation"), ...values }; allocations.push(row); return row; },
    async createAdjustment(values) { const row: Row = { id: nextId("adjustment"), ...values }; adjustments.push(row); return row; },
    async createAdjustmentAllocation(values) { return { id: nextId("adjustment-allocation"), ...values }; },
    async createEraFile(values) { const row: Row = { id: nextId("era-file"), ...values }; eraFiles.push(row); return row; },
    async createEraClaim(values) { const row: Row = { id: nextId("era-claim"), ...values }; eraClaims.push(row); return row; },
    async createEraMatch(values) { const row: Row = { id: nextId("era-match"), ...values }; eraMatches.push(row); return row; },
    async createEraServiceLine(values) { const row: Row = { id: nextId("era-line"), ...values }; eraServiceLines.push(row); return row; },
    async updateEraFile(id, values) {
      const row = eraFiles.find((item) => item.id === id);
      if (!row) throw new Error("ERA file missing");
      Object.assign(row, values);
      return row;
    },
    async updateEraClaim(id, values) {
      const row = eraClaims.find((item) => item.id === id);
      if (!row) throw new Error("ERA claim missing");
      Object.assign(row, values);
      return row;
    },
    async updateClaim(id, values) {
      const row = claims.get(id);
      if (!row) throw new Error("Claim missing");
      Object.assign(row, values);
      return row;
    },
    async createDenial(values) { const row: Row = { id: nextId("denial"), ...values }; denials.push(row); return row; },
    async upsertWorkItem(values) {
      const row: Row = { id: nextId("work"), ...values };
      workItems.push(row);
      return row;
    },
    async postDenialWriteoff(denialId) {
      const denial = denials.find((row) => row.id === denialId);
      if (!denial) throw new Error("Denial missing");
      const row: Row = { id: nextId("writeoff"), denial_id: denialId, amount_cents: denial.amount_cents };
      writeoffs.push(row);
      const claim = claims.get(String(denial.claim_id));
      if (claim) claim.claim_status = "paid";
      return { open_balance_cents: 0, writeoff_cents: denial.amount_cents };
    },
  };

  return {
    repo,
    claims,
    payments,
    allocations,
    adjustments,
    eraFiles,
    eraClaims,
    eraMatches,
    eraServiceLines,
    denials,
    workItems,
    writeoffs,
  };
}

async function importScenario(
  scenario: Parameters<typeof buildTest835>[0],
  traceNumber: string,
  options: { repoState?: ReturnType<typeof makeRoutingRepo>; context?: Partial<typeof base> & Record<string, unknown> } = {},
) {
  const state = options.repoState ?? makeRoutingRepo();
  const context = { ...base, ...options.context, traceNumber } as Parameters<typeof buildTest835>[1];
  const result = await import835Workflow(state.repo, {
    rawText: buildTest835(scenario, context),
    fileName: `${traceNumber}.835`,
  });
  return { state, result };
}

test("clean and partial synthetic ERAs post payment and responsibility correctly", async () => {
  const paid = await importScenario("paid", "ROUTE-PAID");
  assert.equal(paid.result.ok, true);
  assert.equal(paid.state.payments.length, 1);
  assert.equal(paid.state.payments[0].amount_cents, 8000);
  assert.equal(paid.state.allocations[0].amount_cents, 8000);
  assert.equal(paid.state.adjustments[0].amountCents, 2000);
  assert.equal(paid.state.claims.get("claim-1")?.claim_status, "paid");
  assert.equal(paid.state.denials.length, 0);
  assert.equal(paid.state.workItems.length, 0);

  const partial = await importScenario("partial_patient", "ROUTE-PARTIAL-WORKFLOW");
  assert.equal(partial.result.ok, true);
  assert.equal(partial.state.payments[0].amount_cents, 7000);
  assert.equal(partial.state.adjustments[0].amountCents, 2000);
  assert.equal(partial.state.claims.get("claim-1")?.claim_status, "patient_responsibility");
  assert.equal(partial.state.claims.get("claim-1")?.metadata.patient_responsibility_cents, 1000);
  assert.equal(partial.state.claims.get("claim-1")?.metadata.insurance_responsibility_cents, 0);
});

test("synthetic denial routes to follow-up while configured non-workable CARC auto-writes off", async () => {
  const denied = await importScenario("denied", "ROUTE-DENIAL-WORKFLOW");
  assert.equal(denied.result.ok, true);
  assert.equal(denied.state.denials.length, 1);
  assert.equal(denied.state.denials[0].carc_code, "197");
  assert.equal(denied.state.denials[0].rarc_code, "N130");
  assert.equal(denied.state.claims.get("claim-1")?.claim_status, "denied");
  assert.ok(denied.state.workItems.some((row) => row.workqueue_type === "denial_followup" && row.workqueue_status === "open"));

  const auto = await importScenario("denied", "ROUTE-AUTO-WRITEOFF", {
    context: { denialCarcCode: "242" },
  });
  assert.equal(auto.result.ok, true);
  assert.equal(auto.state.denials[0].workability, "auto_writeoff");
  assert.equal(auto.state.writeoffs.length, 1);
  assert.equal(auto.state.workItems.some((row) => row.workqueue_type === "denial_followup"), false);
});

test("unmatched and ambiguous synthetic ERAs route to unmatched review with no financial posting", async () => {
  const unmatched = await importScenario("unmatched", "ROUTE-UNMATCHED", {
    context: { patientControlNumber: "NO-SUCH-CLAIM" },
  });
  assert.equal(unmatched.state.payments.length, 0);
  assert.ok(unmatched.state.workItems.some((row) => row.workqueue_type === "unmatched_era"));

  const ambiguousState = makeRoutingRepo({ ambiguous: true });
  const ambiguous = await importScenario("ambiguous", "ROUTE-AMBIGUOUS", { repoState: ambiguousState });
  assert.equal(ambiguous.state.payments.length, 0);
  assert.equal(ambiguous.state.eraClaims[0].status, "ambiguous");
  assert.ok(ambiguous.state.workItems.some((row) => row.workqueue_type === "unmatched_era"));
});

test("duplicate synthetic ERA trace is blocked without duplicating financial or work records", async () => {
  const state = makeRoutingRepo();
  const rawText = buildTest835("paid", { ...base, traceNumber: "ROUTE-DUPLICATE" });
  const first = await import835Workflow(state.repo, { rawText, fileName: "first.835" });
  const before = {
    payments: state.payments.length,
    allocations: state.allocations.length,
    adjustments: state.adjustments.length,
    denials: state.denials.length,
    workItems: state.workItems.length,
  };
  const second = await import835Workflow(state.repo, { rawText, fileName: "second.835" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.deepEqual({
    payments: state.payments.length,
    allocations: state.allocations.length,
    adjustments: state.adjustments.length,
    denials: state.denials.length,
    workItems: state.workItems.length,
  }, before);
});

test("payer mismatch, reversal, and BPR mismatch remain out of automatic claim posting", async () => {
  const payer = await importScenario("payer_mismatch", "ROUTE-PAYER-MISMATCH-WORKFLOW");
  assert.equal(payer.state.payments.length, 0);
  assert.equal(payer.state.adjustments.length, 0);
  assert.equal(payer.state.claims.get("claim-1")?.claim_status, "accepted");
  assert.ok(payer.state.workItems.some((row) => row.workqueue_type === "payment_posting_issue"));

  const reversal = await importScenario("reversal", "ROUTE-REVERSAL-WORKFLOW");
  assert.equal(reversal.state.adjustments.length, 0);
  assert.equal(reversal.state.claims.get("claim-1")?.claim_status, "accepted");
  assert.ok(reversal.state.workItems.some((row) => String(row.title).includes("reversal/negative adjustment")));

  const reconciliation = await importScenario("paid", "ROUTE-BPR-MISMATCH-WORKFLOW", {
    context: { bprAmountCents: 7000 },
  });
  assert.equal(reconciliation.state.payments.length, 0);
  assert.equal(reconciliation.state.allocations.length, 0);
  assert.equal(reconciliation.state.adjustments.length, 0);
  assert.equal(reconciliation.state.claims.get("claim-1")?.claim_status, "accepted");
  assert.ok(reconciliation.state.workItems.some((row) => String(row.title).includes("payment does not reconcile")));
});
