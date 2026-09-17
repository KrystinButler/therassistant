import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { calculateOpenBalance } from "../ar/aging";
import { isRecoveryAdjustment } from "../ar/variance";
import { validateClaim } from "./repository";
import { isRetryableRejection } from "./workqueues";

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
export type ClaimWorkData = { claim: DataRow; lines: DataRow[]; diagnoses: DataRow[]; responses: DataRow[]; denials: DataRow[]; appeals: DataRow[]; workItems: DataRow[]; history: DataRow[] };
export type ClaimWorkFieldValues = { patient_control_number: string; payer_claim_number: string; service_date_from: string; service_date_to: string; place_of_service_code: string; claim_frequency_code: string; total_charge_cents: number };

function personName(row?: Row) { if (!row) return "—"; return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—"; }
function total(rows: DataRow[], field: string) { return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0); }

export async function getClaimWorkData(claimId: string): Promise<ClaimWorkData | null> {
  const claim = (await tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0];
  if (!claim) return null;
  const [lines, diagnoses, responses, denials, appeals, workItems, history] = await Promise.all([
    tenantSelect<DataRow>("professional_claim_lines", { claim_id: `eq.${claimId}`, order: "service_date.asc" }), tenantSelect<DataRow>("claim_diagnoses", { claim_id: `eq.${claimId}`, order: "pointer_order.asc" }), tenantSelect<DataRow>("submission_responses", { claim_id: `eq.${claimId}`, order: "created_at.desc" }), tenantSelect<DataRow>("denials", { claim_id: `eq.${claimId}`, order: "created_at.desc" }), tenantSelect<DataRow>("appeals", { claim_id: `eq.${claimId}`, order: "created_at.desc" }), tenantSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", source_object_id: `eq.${claimId}`, order: "created_at.desc" }), tenantSelect<DataRow>("claim_status_history", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
  ]);
  return { claim, lines, diagnoses, responses, denials, appeals, workItems, history };
}

export async function saveClaimWorkFields(claimId: string, values: ClaimWorkFieldValues, revalidate = false) {
  const current = (await tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0];
  if (!current) throw new Error("Claim not found.");
  const oldStatus = String(current.claim_status ?? "ready_for_validation");
  const nextStatus = revalidate && !["ready_for_validation", "validation_failed", "corrected"].includes(oldStatus) ? "corrected" : oldStatus;
  await tenantUpdate<DataRow>("professional_claims", claimId, {
    patient_control_number: values.patient_control_number.trim() || null,
    payer_claim_number: values.payer_claim_number.trim() || null,
    service_date_from: values.service_date_from || null,
    service_date_to: values.service_date_to || null,
    place_of_service_code: values.place_of_service_code.trim() || null,
    claim_frequency_code: values.claim_frequency_code.trim() || null,
    total_charge_cents: Math.max(0, Math.round(values.total_charge_cents)),
    ...(nextStatus !== oldStatus ? { claim_status: nextStatus } : {}),
  });
  if (nextStatus !== oldStatus) await tenantInsert<DataRow>("claim_status_history", { claim_id: claimId, old_status: oldStatus, new_status: nextStatus, reason: "Claim fields corrected in work drawer." });
  return revalidate ? validateClaim(claimId) : { kind: "success" as const };
}

export async function getClaimsWorkspaceData() {
  const [claims, clients, providers, payers, lines, diagnoses, responses, denials, appeals, payments, allocations, adjustments, workItems] = await Promise.all([
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }), tenantSelect<DataRow>("clients"), tenantSelect<DataRow>("providers"), referenceSelect<DataRow>("payers", { order: "name.asc" }), tenantSelect<DataRow>("professional_claim_lines", { order: "service_date.asc" }), tenantSelect<DataRow>("claim_diagnoses", { order: "pointer_order.asc" }), tenantSelect<DataRow>("submission_responses", { order: "created_at.desc" }), tenantSelect<DataRow>("denials", { order: "created_at.desc" }), tenantSelect<DataRow>("appeals", { order: "created_at.desc" }), tenantSelect<DataRow>("payments", { order: "created_at.desc" }), tenantSelect<DataRow>("payment_allocations", { order: "created_at.desc" }), tenantSelect<DataRow>("adjustments", { order: "created_at.desc" }), tenantSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", order: "created_at.desc" }),
  ]);
  const clientsById = new Map(clients.map((row) => [row.id, row])); const providersById = new Map(providers.map((row) => [row.id, row])); const payersById = new Map(payers.map((row) => [row.id, row])); const paymentById = new Map(payments.map((row) => [row.id, row]));
  const rows = claims.map((claim): ClaimsWorkspaceRow => {
    const claimId = claim.id; const claimResponses = responses.filter((row) => row.claim_id === claimId); const claimDenials = denials.filter((row) => row.claim_id === claimId); const claimAppeals = appeals.filter((row) => row.claim_id === claimId); const claimAllocations = allocations.filter((row) => row.claim_id === claimId && !row.reversed_at); const activeAdjustments = adjustments.filter((row) => row.claim_id === claimId && !["reversed", "voided"].includes(String(row.adjustment_status ?? ""))); const reducingAdjustments = activeAdjustments.filter((row) => !isRecoveryAdjustment(row.adjustment_type)); const recoveryAdjustments = activeAdjustments.filter((row) => isRecoveryAdjustment(row.adjustment_type)); const paidAmountCents = total(claimAllocations, "amount_cents"); const adjustmentAmountCents = total(reducingAdjustments, "amount_cents"); const recoveryAmountCents = total(recoveryAdjustments, "amount_cents"); const latestResponse = claimResponses[0];
    return { ...claim, clientName: personName(clientsById.get(String(claim.client_id))), providerName: personName(providersById.get(String(claim.rendering_provider_id))), payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"), clearinghouseStatus: String(latestResponse?.response_status ?? "—"), paidAmountCents, adjustmentAmountCents, openBalanceCents: calculateOpenBalance(Number(claim.total_charge_cents ?? 0), paidAmountCents, adjustmentAmountCents, recoveryAmountCents), denialCount: claimDenials.length, appealCount: claimAppeals.length, workCount: workItems.filter((row) => row.source_object_id === claimId && row.workqueue_status !== "completed").length, cptCodes: lines.filter((row) => row.claim_id === claimId).map((row) => String(row.cpt_code ?? "")).filter(Boolean), diagnosisCodes: diagnoses.filter((row) => row.claim_id === claimId).map((row) => String(row.diagnosis_code ?? "")).filter(Boolean) };
  });
  const paymentSignals = allocations.map((allocation) => ({ ...(paymentById.get(String(allocation.payment_id)) ?? allocation), id: String(allocation.payment_id ?? allocation.id), claim_id: allocation.claim_id })); return { claims: rows, responses, denials, appeals, payments, paymentSignals, payers, providers };
}
export async function bulkValidateClaims(claimIds: string[]) { const results = []; for (const claimId of claimIds) results.push(await validateClaim(claimId)); return results; }
async function getLatestSubmissionResponse(claimId: string) { return (await tenantSelect<DataRow>("submission_responses", { claim_id: `eq.${claimId}`, order: "created_at.desc", limit: "1" }))[0]; }
export async function createClaimFollowUps(claimIds: string[]) { for (const claimId of claimIds) { const claim = (await tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0]; if (!claim) continue; const latestResponse = await getLatestSubmissionResponse(claimId); const rejected = isRetryableRejection(claim.claim_status, latestResponse?.response_status); const type = rejected ? "claim_rejection" : "claim_validation"; const existing = await tenantSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", source_object_id: `eq.${claimId}`, workqueue_type: `eq.${type}`, workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)", limit: "1" }); if (existing[0]) continue; await tenantInsert<DataRow>("workqueue_items", { workqueue_type: type, workqueue_status: "open", priority: rejected ? "high" : "normal", source_object_type: "claim", source_object_id: claimId, title: `${rejected ? "Rejected claim" : "Claim follow-up"}: ${String(claim.patient_control_number ?? claimId)}`, description: "Created from the Claims workspace for operational follow-up." }); } }
export async function retryRejectedClaims(claimIds: string[]) { for (const claimId of claimIds) { const claim = (await tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }))[0]; if (!claim) continue; const latestResponse = await getLatestSubmissionResponse(claimId); if (!isRetryableRejection(claim.claim_status, latestResponse?.response_status)) continue; const oldStatus = String(claim.claim_status ?? ""); await tenantUpdate<DataRow>("professional_claims", claimId, { claim_status: "ready_for_validation", accepted_at: null }); await tenantInsert<DataRow>("claim_status_history", { claim_id: claimId, old_status: oldStatus, new_status: "ready_for_validation", reason: "Corrected claim returned to validation after clearinghouse rejection." }); } }
