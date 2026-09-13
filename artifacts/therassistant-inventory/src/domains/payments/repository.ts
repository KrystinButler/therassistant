import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import {
  buildAllocationPlan,
  buildPaymentReversal,
  validatePaymentDraft,
} from "./operations";
import {
  createDenialFromAdjudicationWorkflow,
  postDemoEraWorkflow,
  postInsurancePaymentWorkflow,
  type PaymentRepository,
} from "./workflow";

type DataRow = Row & { id: string };
type EnrichedClaimRow = DataRow & { clientName: string; payerName: string };
type EnrichedPaymentRow = DataRow & { clientName: string; payerName: string; allocatedCents: number; unappliedCents: number };
type AllocationRow = DataRow & { claimControlNumber: string; patientName: string; traceNumber: string };
type EraClaimRow = DataRow & { patientName: string };
type DenialRow = DataRow & { patientName: string; payerName: string; claimControlNumber: string };
type ReversalRow = DataRow & { traceNumber: string; patientName: string; amountCents: number };
type AdjustmentRow = DataRow & { patientName: string; payerName: string; claimControlNumber: string };

function first<T>(rows: T[]) { return rows[0] ?? null; }

const repository: PaymentRepository = {
  async getClaim(claimId) {
    return first(await demoSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }));
  },
  createPayment(values) { return demoInsert<DataRow>("payments", values); },
  updatePayment(id, values) { return demoUpdate<DataRow>("payments", id, values); },
  createPaymentAllocation(values) { return demoInsert<DataRow>("payment_allocations", values); },
  createAdjustment(values) { return demoInsert<DataRow>("adjustments", values); },
  createAdjustmentAllocation(values) { return demoInsert<DataRow>("adjustment_allocations", values); },
  createEraFile(values) { return demoInsert<DataRow>("era_files", values); },
  createEraClaim(values) { return demoInsert<DataRow>("era_claims", values); },
  createEraMatch(values) { return demoInsert<DataRow>("era_matches", values); },
  updateEraFile(id, values) { return demoUpdate<DataRow>("era_files", id, values); },
  updateClaim(id, values) { return demoUpdate<DataRow>("professional_claims", id, values); },
  createDenial(values) { return demoInsert<DataRow>("denials", values); },
  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await demoSelect<DataRow>("workqueue_items", {
      source_object_type: `eq.${String(values.source_object_type ?? "denial")}`,
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return demoUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return demoInsert<DataRow>("workqueue_items", values);
  },
};

export function postInsurancePayment(input: Parameters<typeof postInsurancePaymentWorkflow>[1]) { return postInsurancePaymentWorkflow(repository, input); }
export function postDemoEra(input: Parameters<typeof postDemoEraWorkflow>[1]) { return postDemoEraWorkflow(repository, input); }
export function createDenialFromAdjudication(input: Parameters<typeof createDenialFromAdjudicationWorkflow>[1]) { return createDenialFromAdjudicationWorkflow(repository, input); }

export async function postManualPayment(input: {
  amountCents: number;
  source: string;
  method: string;
  clientId?: string;
  payerId?: string;
  claimId?: string;
  allocationCents?: number;
  traceNumber?: string;
  checkNumber?: string;
  notes?: string;
}) {
  const draft = validatePaymentDraft({ amountCents: input.amountCents, source: input.source, method: input.method });
  const allocationCents = input.claimId ? Number(input.allocationCents ?? input.amountCents) : 0;
  const plan = buildAllocationPlan(input.amountCents, allocationCents > 0 ? [allocationCents] : []);
  let claim: DataRow | null = null;
  if (input.claimId) {
    claim = first(await demoSelect<DataRow>("professional_claims", { id: `eq.${input.claimId}`, limit: "1" }));
    if (!claim) throw new Error("Selected claim was not found.");
  }
  const payment = await demoInsert<DataRow>("payments", {
    client_id: input.clientId || claim?.client_id || null,
    payer_id: draft.source === "insurance" ? (input.payerId || claim?.payer_id || null) : null,
    payment_source: draft.source,
    payment_method: draft.method,
    payment_status: "pending",
    payment_date: new Date().toISOString().slice(0, 10),
    amount_cents: draft.amountCents,
    trace_number: input.traceNumber?.trim() || null,
    check_number: input.checkNumber?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (claim && allocationCents > 0) {
    await demoInsert<DataRow>("payment_allocations", {
      payment_id: payment.id,
      client_id: input.clientId || claim.client_id || null,
      claim_id: claim.id,
      amount_cents: allocationCents,
    });
  }
  return demoUpdate<DataRow>("payments", payment.id, {
    payment_status: plan.status,
    posted_at: plan.allocatedCents > 0 ? new Date().toISOString() : null,
  });
}

export async function reversePayment(paymentId: string, reason: string) {
  const payment = first(await demoSelect<DataRow>("payments", { id: `eq.${paymentId}`, limit: "1" }));
  if (!payment) throw new Error("Payment not found.");
  if (["reversed", "voided"].includes(String(payment.payment_status ?? ""))) throw new Error("Payment is already reversed or voided.");
  const allocations = await demoSelect<DataRow>("payment_allocations", { payment_id: `eq.${paymentId}`, order: "created_at.asc" });
  const activeAllocations = allocations.filter((row) => !row.reversed_at);
  const reversal = buildPaymentReversal({ paymentId, allocationIds: activeAllocations.map((row) => row.id), reason });
  await demoInsert<DataRow>("payment_reversals", { payment_id: paymentId, reason: reversal.reason });
  for (const allocation of activeAllocations) {
    await demoUpdate<DataRow>("payment_allocations", allocation.id, { reversed_at: reversal.reversedAt });
  }
  return demoUpdate<DataRow>("payments", paymentId, { payment_status: reversal.paymentStatus });
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export async function getPaymentsWorkspaceData() {
  const [claims, clients, payers, payments, allocations, reversals, adjustments, eraFiles, eraClaims, denials] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("clients"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("payments", { order: "created_at.desc" }),
    demoSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    demoSelect<DataRow>("payment_reversals", { order: "created_at.desc" }),
    demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    demoSelect<DataRow>("era_files", { order: "created_at.desc" }),
    demoSelect<DataRow>("era_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("denials", { order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const paymentsById = new Map(payments.map((row) => [row.id, row]));
  const activeAllocations = allocations.filter((row) => !row.reversed_at);

  const claimRows = claims.map((claim): EnrichedClaimRow => ({
    ...claim,
    clientName: personName(clientsById.get(String(claim.client_id))),
    payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"),
  }));

  const paymentRows = payments.map((payment): EnrichedPaymentRow => {
    const allocatedCents = activeAllocations.filter((row) => row.payment_id === payment.id).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
    return {
      ...payment,
      clientName: personName(clientsById.get(String(payment.client_id))),
      payerName: String(payersById.get(String(payment.payer_id))?.name ?? "—"),
      allocatedCents,
      unappliedCents: Math.max(0, Number(payment.amount_cents ?? 0) - allocatedCents),
    };
  });

  const allocationRows = allocations.map((allocation): AllocationRow => {
    const claim = claimsById.get(String(allocation.claim_id));
    const payment = paymentsById.get(String(allocation.payment_id));
    return {
      ...allocation,
      claimControlNumber: String(claim?.patient_control_number ?? "—"),
      patientName: personName(clientsById.get(String(allocation.client_id))),
      traceNumber: String(payment?.trace_number ?? payment?.check_number ?? "—"),
    };
  });

  const reversalRows = reversals.map((reversal): ReversalRow => {
    const payment = paymentsById.get(String(reversal.payment_id));
    return {
      ...reversal,
      traceNumber: String(payment?.trace_number ?? payment?.check_number ?? "—"),
      patientName: personName(clientsById.get(String(payment?.client_id ?? ""))),
      amountCents: Number(payment?.amount_cents ?? 0),
    };
  });

  const adjustmentRows = adjustments.map((adjustment): AdjustmentRow => {
    const claim = claimsById.get(String(adjustment.claim_id));
    return {
      ...adjustment,
      patientName: personName(clientsById.get(String(adjustment.client_id ?? claim?.client_id ?? ""))),
      payerName: String(payersById.get(String(adjustment.payer_id ?? claim?.payer_id ?? ""))?.name ?? "—"),
      claimControlNumber: String(claim?.patient_control_number ?? "—"),
    };
  });

  const eraClaimRows = eraClaims.map((eraClaim): EraClaimRow => ({ ...eraClaim, patientName: personName(clientsById.get(String(eraClaim.client_id))) }));
  const denialRows = denials.map((denial): DenialRow => ({
    ...denial,
    patientName: personName(clientsById.get(String(denial.client_id))),
    payerName: String(payersById.get(String(denial.payer_id))?.name ?? "—"),
    claimControlNumber: String(claimsById.get(String(denial.claim_id))?.patient_control_number ?? "—"),
  }));

  return {
    claims: claimRows,
    clients,
    payers,
    payments: paymentRows,
    allocations: allocationRows,
    reversals: reversalRows,
    adjustments: adjustmentRows,
    eraFiles,
    eraClaims: eraClaimRows,
    denials: denialRows,
  };
}
