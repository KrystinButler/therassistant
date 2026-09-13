import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import { validateClaim } from "./repository";

type DataRow = Row & { id: string };
export type ClaimsWorkspaceRow = DataRow & {
  clientName: string;
  providerName: string;
  payerName: string;
  clearinghouseStatus: string;
  paidAmountCents: number;
  adjustmentAmountCents: number;
  openBalanceCents: number;
  denialCount: number;
  appealCount: number;
  workCount: number;
  cptCodes: string[];
  diagnosisCodes: string[];
};

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export async function getClaimsWorkspaceData() {
  const [claims, clients, providers, payers, lines, diagnoses, responses, denials, appeals, payments, allocations, adjustments, workItems] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("clients"),
    demoSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("professional_claim_lines", { order: "service_date.asc" }),
    demoSelect<DataRow>("claim_diagnoses", { order: "pointer_order.asc" }),
    demoSelect<DataRow>("submission_responses", { order: "created_at.desc" }),
    demoSelect<DataRow>("denials", { order: "created_at.desc" }),
    demoSelect<DataRow>("appeals", { order: "created_at.desc" }),
    demoSelect<DataRow>("payments", { order: "created_at.desc" }),
    demoSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    demoSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const paymentById = new Map(payments.map((row) => [row.id, row]));

  const rows = claims.map((claim): ClaimsWorkspaceRow => {
    const claimId = claim.id;
    const claimResponses = responses.filter((row) => row.claim_id === claimId);
    const claimDenials = denials.filter((row) => row.claim_id === claimId);
    const claimAppeals = appeals.filter((row) => row.claim_id === claimId);
    const claimAllocations = allocations.filter((row) => row.claim_id === claimId && !row.reversed_at);
    const claimAdjustments = adjustments.filter(
      (row) => row.claim_id === claimId && !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
    );
    const paidAmountCents = total(claimAllocations, "amount_cents");
    const adjustmentAmountCents = total(claimAdjustments, "amount_cents");
    const latestResponse = claimResponses[0];
    return {
      ...claim,
      clientName: personName(clientsById.get(String(claim.client_id))),
      providerName: personName(providersById.get(String(claim.rendering_provider_id))),
      payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"),
      clearinghouseStatus: String(latestResponse?.response_status ?? "—"),
      paidAmountCents,
      adjustmentAmountCents,
      openBalanceCents: Math.max(0, Number(claim.total_charge_cents ?? 0) - paidAmountCents - adjustmentAmountCents),
      denialCount: claimDenials.length,
      appealCount: claimAppeals.length,
      workCount: workItems.filter((row) => row.source_object_id === claimId && row.workqueue_status !== "completed").length,
      cptCodes: lines.filter((row) => row.claim_id === claimId).map((row) => String(row.cpt_code ?? "")).filter(Boolean),
      diagnosisCodes: diagnoses.filter((row) => row.claim_id === claimId).map((row) => String(row.diagnosis_code ?? "")).filter(Boolean),
    };
  });

  const paymentSignals = allocations.map((allocation) => ({
    ...(paymentById.get(String(allocation.payment_id)) ?? allocation),
    id: String(allocation.payment_id ?? allocation.id),
    claim_id: allocation.claim_id,
  }));

  return { claims: rows, responses, denials, appeals, payments, paymentSignals, payers, providers };
}

export async function bulkValidateClaims(claimIds: string[]) {
  const results = [];
  for (const claimId of claimIds) results.push(await validateClaim(claimId));
  return results;
}

export async function createClaimFollowUps(claimIds: string[]) {
  for (const claimId of claimIds) {
    const existing = await demoSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.claim",
      source_object_id: `eq.${claimId}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) continue;
    const claim = (await demoSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0];
    if (!claim) continue;
    const rejected = claim.claim_status === "rejected";
    await demoInsert<DataRow>("workqueue_items", {
      workqueue_type: rejected ? "claim_rejection" : "claim_validation",
      workqueue_status: "open",
      priority: rejected ? "high" : "normal",
      source_object_type: "claim",
      source_object_id: claimId,
      title: `${rejected ? "Rejected claim" : "Claim follow-up"}: ${String(claim.patient_control_number ?? claimId)}`,
      description: "Created from the Claims workspace for operational follow-up.",
    });
  }
}

export async function retryRejectedClaims(claimIds: string[]) {
  for (const claimId of claimIds) {
    const claim = (await demoSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0];
    if (!claim || claim.claim_status !== "rejected") continue;
    await demoUpdate<DataRow>("professional_claims", claimId, {
      claim_status: "ready_for_validation",
      accepted_at: null,
    });
    await demoInsert<DataRow>("claim_status_history", {
      claim_id: claimId,
      old_status: "rejected",
      new_status: "ready_for_validation",
      reason: "Corrected claim returned to validation after clearinghouse rejection.",
    });
  }
}
