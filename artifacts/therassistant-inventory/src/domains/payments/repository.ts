import {
  getCurrentTenantId,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { isRecoveryAdjustment } from "../ar/variance";
import {
  buildAllocationPlan,
  capAllocationToOpenBalance,
  resolvePaymentOwnership,
  summarizePaymentBalance,
  validatePaymentDraft,
} from "./operations";
import {
  createDenialFromAdjudicationWorkflow,
  import835Workflow,
  postInsurancePaymentWorkflow,
  type EraImportRepository,
} from "./workflow";

type DataRow = Row & { id: string };
type EnrichedClaimRow = DataRow & { clientName: string; payerName: string };
type EnrichedPaymentRow = DataRow & { clientName: string; payerName: string; allocatedCents: number; unappliedCents: number };
type AllocationRow = DataRow & { claimControlNumber: string; patientName: string; traceNumber: string };
type EraClaimRow = DataRow & { patientName: string };
type DenialRow = DataRow & { patientName: string; payerName: string; claimControlNumber: string };
type ReversalRow = DataRow & { traceNumber: string; patientName: string; amountCents: number };
type AdjustmentRow = DataRow & { patientName: string; payerName: string; claimControlNumber: string };

type PaymentReversalResult = {
  payment_id: string;
  payment_status: "reversed";
  reversed_at: string;
  allocation_count: number;
};

type ManualPaymentResult = DataRow;

function first<T>(rows: T[]) { return rows[0] ?? null; }

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

const repository: EraImportRepository = {
  async getClaim(claimId) {
    return first(await tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }));
  },
  findClaimsByPatientControlNumber(patientControlNumber) {
    return tenantSelect<DataRow>("professional_claims", {
      patient_control_number: `eq.${patientControlNumber}`,
      order: "created_at.desc",
    });
  },
  getClaimLines(claimId) {
    return tenantSelect<DataRow>("professional_claim_lines", {
      claim_id: `eq.${claimId}`,
      order: "service_date.asc,created_at.asc",
    });
  },
  async getEraFileByTrace(traceNumber) {
    return first(await tenantSelect<DataRow>("era_files", {
      check_or_trace_number: `eq.${traceNumber}`,
      order: "created_at.desc",
      limit: "1",
    }));
  },
  createPayment(values) { return tenantInsert<DataRow>("payments", values); },
  updatePayment(id, values) { return tenantUpdate<DataRow>("payments", id, values); },
  createPaymentAllocation(values) { return tenantInsert<DataRow>("payment_allocations", values); },
  createAdjustment(values) { return tenantInsert<DataRow>("adjustments", values); },
  createAdjustmentAllocation(values) { return tenantInsert<DataRow>("adjustment_allocations", values); },
  createEraFile(values) { return tenantInsert<DataRow>("era_files", values); },
  createEraClaim(values) { return tenantInsert<DataRow>("era_claims", values); },
  createEraMatch(values) { return tenantInsert<DataRow>("era_matches", values); },
  createEraServiceLine(values) { return tenantInsert<DataRow>("era_service_lines", values); },
  updateEraFile(id, values) { return tenantUpdate<DataRow>("era_files", id, values); },
  updateEraClaim(id, values) { return tenantUpdate<DataRow>("era_claims", id, values); },
  updateClaim(id, values) { return tenantUpdate<DataRow>("professional_claims", id, values); },
  createDenial(values) { return tenantInsert<DataRow>("denials", values); },
  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await tenantSelect<DataRow>("workqueue_items", {
      source_object_type: `eq.${String(values.source_object_type ?? "denial")}`,
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return tenantUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return tenantInsert<DataRow>("workqueue_items", values);
  },
};

export function postInsurancePayment(input: Parameters<typeof postInsurancePaymentWorkflow>[1]) { return postInsurancePaymentWorkflow(repository, input); }
export function import835(input: Parameters<typeof import835Workflow>[1]) { return import835Workflow(repository, input); }
export function createDenialFromAdjudication(input: Parameters<typeof createDenialFromAdjudicationWorkflow>[1]) { return createDenialFromAdjudicationWorkflow(repository, input); }

async function getClaimFinancialState(claim: DataRow) {
  const [allocations, adjustments] = await Promise.all([
    tenantSelect<DataRow>("payment_allocations", { claim_id: `eq.${claim.id}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { claim_id: `eq.${claim.id}`, order: "created_at.desc" }),
  ]);
  const paidCents = total(allocations.filter((row) => !row.reversed_at), "amount_cents");
  const activeAdjustments = adjustments.filter(
    (row) => !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
  );
  const adjustmentCents = total(
    activeAdjustments.filter((row) => !isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  const recoveryCents = total(
    activeAdjustments.filter((row) => isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  const chargeCents = Number(claim.total_charge_cents ?? 0);
  const openBalanceCents = Math.max(0, chargeCents - paidCents - adjustmentCents + recoveryCents);
  return { chargeCents, paidCents, adjustmentCents, recoveryCents, openBalanceCents };
}

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
  const requestedAllocationCents = input.claimId ? Number(input.allocationCents ?? input.amountCents) : 0;
  let claim: DataRow | null = null;
  let allocationCents = 0;
  if (input.claimId) {
    claim = first(await tenantSelect<DataRow>("professional_claims", { id: `eq.${input.claimId}`, limit: "1" }));
    if (!claim) throw new Error("Selected claim was not found.");
    const financials = await getClaimFinancialState(claim);
    allocationCents = capAllocationToOpenBalance(requestedAllocationCents, financials.openBalanceCents);
  }
  const plan = buildAllocationPlan(input.amountCents, allocationCents > 0 ? [allocationCents] : []);
  const ownership = resolvePaymentOwnership({
    source: draft.source,
    requestedClientId: input.clientId,
    requestedPayerId: input.payerId,
    claimClientId: claim ? String(claim.client_id ?? "") || undefined : undefined,
    claimPayerId: claim ? String(claim.payer_id ?? "") || undefined : undefined,
  });
  const tenantId = await getCurrentTenantId();
  return tenantRpc<ManualPaymentResult>("post_manual_payment", {
    p_tenant_id: tenantId,
    p_amount_cents: draft.amountCents,
    p_source: draft.source,
    p_method: draft.method,
    p_client_id: ownership.clientId,
    p_payer_id: ownership.payerId,
    p_claim_id: claim?.id ?? null,
    p_allocation_cents: plan.allocatedCents,
    p_trace_number: input.traceNumber?.trim() || null,
    p_check_number: input.checkNumber?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
}

export async function reversePayment(paymentId: string, reason: string) {
  if (!paymentId) throw new Error("Payment is required.");
  if (!reason.trim()) throw new Error("Reversal reason is required.");
  const tenantId = await getCurrentTenantId();
  return tenantRpc<PaymentReversalResult>("reverse_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_reason: reason.trim(),
  });
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export async function getPaymentsWorkspaceData() {
  const [claims, clients, payers, payments, allocations, reversals, adjustments, eraFiles, eraClaims, denials] = await Promise.all([
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clients"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("payments", { order: "created_at.desc" }),
    tenantSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("payment_reversals", { order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    tenantSelect<DataRow>("era_files", { order: "created_at.desc" }),
    tenantSelect<DataRow>("era_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("denials", { order: "created_at.desc" }),
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
    const activeAllocatedCents = activeAllocations.filter((row) => row.payment_id === payment.id).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
    const balance = summarizePaymentBalance(payment.payment_status, Number(payment.amount_cents ?? 0), activeAllocatedCents);
    return {
      ...payment,
      clientName: personName(clientsById.get(String(payment.client_id))),
      payerName: String(payersById.get(String(payment.payer_id))?.name ?? "—"),
      ...balance,
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
