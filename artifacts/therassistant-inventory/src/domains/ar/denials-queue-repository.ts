import { tenantInsert, tenantSelect, tenantUpdate, referenceSelect, type Row } from "../../lib/tenant-data-client";
import { classifyDenialPolicy, type DenialPolicy } from "./denials";
import { isRecoveryAdjustment } from "./variance";

export type DataRow = Row & { id: string };
export type DenialQueueRow = DataRow & {
  claimNumber: string;
  payerClaimNumber: string;
  clientName: string;
  payerName: string;
  providerName: string;
  policy: DenialPolicy;
  activeAppealId: string;
  claimStatus: string;
  workStatus: string;
  serviceDate: string;
  chargeAmountCents: number;
  allowedAmountCents: number;
  paidAmountCents: number;
};
export type DenialAppealRow = DataRow & {
  claimNumber: string;
  clientName: string;
  payerName: string;
  denialCategory: string;
};

const ACTIVE_APPEAL_STATUSES = ["not_started", "drafting", "submitted", "pending"];
const ACTIVE_WORK_STATUSES = ["open", "in_progress", "pending", "snoozed", "reopened"];

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export async function getDenialsQueueData() {
  const [denials, claims, clients, providers, payers, appeals, workItems, allocations, adjustments] = await Promise.all([
    tenantSelect<DataRow>("denials", { order: "created_at.desc" }),
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clients"),
    tenantSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("appeals", { order: "created_at.desc" }),
    tenantSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
    tenantSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { order: "created_at.desc" }),
  ]);

  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const denialsById = new Map(denials.map((row) => [row.id, row]));

  const activeAppealByDenial = new Map<string, DataRow>();
  for (const appeal of appeals) {
    const denialId = String(appeal.denial_id ?? "");
    if (
      denialId
      && ACTIVE_APPEAL_STATUSES.includes(String(appeal.appeal_status ?? ""))
      && !activeAppealByDenial.has(denialId)
    ) {
      activeAppealByDenial.set(denialId, appeal);
    }
  }

  const activeWorkByDenial = new Map<string, DataRow>();
  for (const work of workItems) {
    if (work.source_object_type !== "denial") continue;
    if (work.workqueue_type !== "denial_followup") continue;
    if (!ACTIVE_WORK_STATUSES.includes(String(work.workqueue_status ?? ""))) continue;
    const denialId = String(work.source_object_id ?? "");
    if (denialId && !activeWorkByDenial.has(denialId)) activeWorkByDenial.set(denialId, work);
  }

  const rows: DenialQueueRow[] = denials.map((denial) => {
    const claim = claimsById.get(String(denial.claim_id ?? ""));
    const clientId = String(denial.client_id ?? claim?.client_id ?? "");
    const payerId = String(denial.payer_id ?? claim?.payer_id ?? "");
    const work = activeWorkByDenial.get(denial.id);
    const claimId = String(claim?.id ?? "");
    const claimAllocations = allocations.filter((row) => String(row.claim_id ?? "") === claimId && !row.reversed_at);
    const claimAdjustments = adjustments.filter((row) =>
      String(row.claim_id ?? "") === claimId
      && !["reversed", "voided"].includes(String(row.adjustment_status ?? ""))
      && !isRecoveryAdjustment(row.adjustment_type),
    );
    const chargeAmountCents = Number(claim?.total_charge_cents ?? 0);
    const paidAmountCents = total(claimAllocations, "amount_cents");
    const explicitAllowedCents = Number(claim?.allowed_amount_cents ?? claim?.allowed_cents ?? 0);
    const allowedAmountCents = explicitAllowedCents > 0
      ? explicitAllowedCents
      : Math.max(0, chargeAmountCents - total(claimAdjustments, "amount_cents"));

    return {
      ...denial,
      claimNumber: String(claim?.patient_control_number ?? "—"),
      payerClaimNumber: String(claim?.payer_claim_number ?? "—"),
      clientName: personName(clientsById.get(clientId)),
      payerName: String(payersById.get(payerId)?.name ?? "—"),
      providerName: personName(providersById.get(String(claim?.rendering_provider_id ?? ""))),
      policy: classifyDenialPolicy(denial.denial_category),
      activeAppealId: activeAppealByDenial.get(denial.id)?.id ?? "",
      claimStatus: String(claim?.claim_status ?? ""),
      workStatus: String(work?.workqueue_status ?? ""),
      serviceDate: String(claim?.service_date_from ?? ""),
      chargeAmountCents,
      allowedAmountCents,
      paidAmountCents,
    };
  });

  const appealRows: DenialAppealRow[] = appeals.map((appeal) => {
    const denial = denialsById.get(String(appeal.denial_id ?? ""));
    const claim = claimsById.get(String(appeal.claim_id ?? denial?.claim_id ?? ""));
    const clientId = String(denial?.client_id ?? claim?.client_id ?? "");
    const payerId = String(denial?.payer_id ?? claim?.payer_id ?? "");
    return {
      ...appeal,
      claimNumber: String(claim?.patient_control_number ?? "—"),
      clientName: personName(clientsById.get(clientId)),
      payerName: String(payersById.get(payerId)?.name ?? "—"),
      denialCategory: String(denial?.denial_category ?? "other"),
    };
  });

  return { denials: rows, appeals: appealRows, payers };
}

async function activeDenialWork(denialId: string) {
  return (
    await tenantSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.denial",
      source_object_id: `eq.${denialId}`,
      workqueue_type: "eq.denial_followup",
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    })
  )[0] ?? null;
}

export async function deferDenial(denialId: string) {
  const work = await activeDenialWork(denialId);
  if (work) return tenantUpdate<DataRow>("workqueue_items", work.id, { workqueue_status: "snoozed" });
  return tenantInsert<DataRow>("workqueue_items", {
    workqueue_type: "denial_followup",
    workqueue_status: "snoozed",
    priority: "normal",
    source_object_type: "denial",
    source_object_id: denialId,
    title: "Deferred denial follow-up",
    description: "Deferred from the Denials queue for later payer follow-up.",
  });
}

export async function resumeDenial(denialId: string) {
  const work = await activeDenialWork(denialId);
  if (!work) return null;
  return tenantUpdate<DataRow>("workqueue_items", work.id, { workqueue_status: "open" });
}
