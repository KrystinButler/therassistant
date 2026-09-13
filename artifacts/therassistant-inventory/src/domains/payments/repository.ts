import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import {
  createDenialFromAdjudicationWorkflow,
  postDemoEraWorkflow,
  postInsurancePaymentWorkflow,
  type PaymentRepository,
} from "./workflow";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

const repository: PaymentRepository = {
  async getClaim(claimId) {
    return first(
      await demoSelect<DataRow>("professional_claims", {
        id: `eq.${claimId}`,
        limit: "1",
      }),
    );
  },

  createPayment(values) {
    return demoInsert<DataRow>("payments", values);
  },

  updatePayment(id, values) {
    return demoUpdate<DataRow>("payments", id, values);
  },

  createPaymentAllocation(values) {
    return demoInsert<DataRow>("payment_allocations", values);
  },

  createAdjustment(values) {
    return demoInsert<DataRow>("adjustments", values);
  },

  createAdjustmentAllocation(values) {
    return demoInsert<DataRow>("adjustment_allocations", values);
  },

  createEraFile(values) {
    return demoInsert<DataRow>("era_files", values);
  },

  createEraClaim(values) {
    return demoInsert<DataRow>("era_claims", values);
  },

  createEraMatch(values) {
    return demoInsert<DataRow>("era_matches", values);
  },

  updateEraFile(id, values) {
    return demoUpdate<DataRow>("era_files", id, values);
  },

  updateClaim(id, values) {
    return demoUpdate<DataRow>("professional_claims", id, values);
  },

  createDenial(values) {
    return demoInsert<DataRow>("denials", values);
  },

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

export function postInsurancePayment(input: Parameters<typeof postInsurancePaymentWorkflow>[1]) {
  return postInsurancePaymentWorkflow(repository, input);
}

export function postDemoEra(input: Parameters<typeof postDemoEraWorkflow>[1]) {
  return postDemoEraWorkflow(repository, input);
}

export function createDenialFromAdjudication(
  input: Parameters<typeof createDenialFromAdjudicationWorkflow>[1],
) {
  return createDenialFromAdjudicationWorkflow(repository, input);
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export async function getPaymentsWorkspaceData() {
  const [claims, clients, payers, payments, allocations, adjustments, eraFiles, eraClaims, denials] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("clients"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("payments", { order: "created_at.desc" }),
    demoSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    demoSelect<DataRow>("era_files", { order: "created_at.desc" }),
    demoSelect<DataRow>("era_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("denials", { order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const paymentsById = new Map(payments.map((row) => [row.id, row]));

  const claimRows = claims.map((claim) => ({
    ...claim,
    clientName: personName(clientsById.get(String(claim.client_id))),
    payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"),
  }));

  const paymentRows = payments.map((payment) => ({
    ...payment,
    clientName: personName(clientsById.get(String(payment.client_id))),
    payerName: String(payersById.get(String(payment.payer_id))?.name ?? "—"),
  }));

  const allocationRows = allocations.map((allocation) => {
    const claim = claimsById.get(String(allocation.claim_id));
    const payment = paymentsById.get(String(allocation.payment_id));
    return {
      ...allocation,
      claimControlNumber: String(claim?.patient_control_number ?? "—"),
      patientName: personName(clientsById.get(String(allocation.client_id))),
      traceNumber: String(payment?.trace_number ?? "—"),
    };
  });

  const eraClaimRows = eraClaims.map((eraClaim) => ({
    ...eraClaim,
    patientName: personName(clientsById.get(String(eraClaim.client_id))),
  }));

  const denialRows = denials.map((denial) => ({
    ...denial,
    patientName: personName(clientsById.get(String(denial.client_id))),
    payerName: String(payersById.get(String(denial.payer_id))?.name ?? "—"),
    claimControlNumber: String(claimsById.get(String(denial.claim_id))?.patient_control_number ?? "—"),
  }));

  return {
    claims: claimRows,
    payments: paymentRows,
    allocations: allocationRows,
    adjustments,
    eraFiles,
    eraClaims: eraClaimRows,
    denials: denialRows,
  };
}
