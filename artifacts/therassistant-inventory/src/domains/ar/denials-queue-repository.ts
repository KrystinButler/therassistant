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
  dateOfBirth: string;
  memberId: string;
  renderingProviderCredentials: string;
  renderingProviderNpi: string;
  billingProviderName: string;
  billingProviderNpi: string;
  cptCodes: string[];
  modifiers: string[];
  diagnosisCodes: string[];
  submittedAt: string;
  authorizationNumber: string;
  authorizationStartDate: string;
  authorizationEndDate: string;
  clinicalDurationMinutes: number | null;
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

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function groupRows(rows: DataRow[], field: string) {
  const grouped = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = String(row[field] ?? "");
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return grouped;
}

function coversDate(row: DataRow, date: string, startField: string, endField: string) {
  if (!date) return true;
  const start = String(row[startField] ?? "");
  const end = String(row[endField] ?? "");
  return (!start || start <= date) && (!end || end >= date);
}

export async function getDenialsQueueData() {
  const [
    denials,
    claims,
    clients,
    providers,
    payers,
    appeals,
    workItems,
    allocations,
    adjustments,
    claimLines,
    claimDiagnoses,
    insurancePolicies,
    authorizations,
    charges,
    clinicalNotes,
  ] = await Promise.all([
    tenantSelect<DataRow>("denials", { order: "created_at.desc" }),
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clients"),
    tenantSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("appeals", { order: "created_at.desc" }),
    tenantSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
    tenantSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    tenantSelect<DataRow>("professional_claim_lines", { order: "service_date.asc" }),
    tenantSelect<DataRow>("claim_diagnoses", { order: "pointer_order.asc" }),
    tenantSelect<DataRow>("client_insurance_policies", { order: "created_at.desc" }),
    tenantSelect<DataRow>("authorizations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clinical_notes", { order: "created_at.desc" }),
  ]);

  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const denialsById = new Map(denials.map((row) => [row.id, row]));
  const chargesById = new Map(charges.map((row) => [row.id, row]));
  const clinicalNotesById = new Map(clinicalNotes.map((row) => [row.id, row]));
  const claimLinesByClaim = groupRows(claimLines, "claim_id");
  const diagnosesByClaim = groupRows(claimDiagnoses, "claim_id");
  const policiesByClient = groupRows(insurancePolicies, "client_id");
  const authorizationsByClient = groupRows(authorizations, "client_id");

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
    const serviceDate = String(claim?.service_date_from ?? "");
    const client = clientsById.get(clientId);
    const renderingProvider = providersById.get(String(claim?.rendering_provider_id ?? ""));
    const billingProvider = providersById.get(String(claim?.billing_provider_id ?? ""));
    const lines = claimLinesByClaim.get(claimId) ?? [];
    const diagnoses = diagnosesByClaim.get(claimId) ?? [];
    const insuranceOptions = (policiesByClient.get(clientId) ?? []).filter((row) => !payerId || String(row.payer_id ?? "") === payerId);
    const insurancePolicy = insuranceOptions.find((row) => coversDate(row, serviceDate, "effective_date", "termination_date")) ?? insuranceOptions[0];
    const authorizationOptions = (authorizationsByClient.get(clientId) ?? []).filter((row) => !payerId || !row.payer_id || String(row.payer_id ?? "") === payerId);
    const authorization = authorizationOptions.find((row) => coversDate(row, serviceDate, "start_date", "end_date")) ?? authorizationOptions[0];
    const charge = chargesById.get(String(claim?.charge_id ?? ""));
    const clinicalNote = clinicalNotesById.get(String(charge?.clinical_note_id ?? ""));
    const cptCodes = uniqueStrings([...lines.map((row) => row.cpt_code), charge?.cpt_code]);
    const modifiers = uniqueStrings(lines.flatMap((row) => [row.modifier1, row.modifier2]).concat([charge?.modifier1, charge?.modifier2]));
    const diagnosisCodes = uniqueStrings([...diagnoses.map((row) => row.diagnosis_code), charge?.diagnosis_code]);
    const durationRaw = clinicalNote?.duration_minutes;
    const clinicalDurationMinutes = durationRaw == null || durationRaw === "" ? null : Number(durationRaw);
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
      clientName: personName(client),
      payerName: String(payersById.get(payerId)?.name ?? "—"),
      providerName: personName(renderingProvider),
      policy: classifyDenialPolicy(denial.denial_category, denial.carc_code),
      activeAppealId: activeAppealByDenial.get(denial.id)?.id ?? "",
      claimStatus: String(claim?.claim_status ?? ""),
      workStatus: String(work?.workqueue_status ?? ""),
      serviceDate,
      chargeAmountCents,
      allowedAmountCents,
      paidAmountCents,
      dateOfBirth: String(client?.date_of_birth ?? ""),
      memberId: String(insurancePolicy?.member_id ?? ""),
      renderingProviderCredentials: String(renderingProvider?.credentials ?? ""),
      renderingProviderNpi: String(renderingProvider?.individual_npi ?? ""),
      billingProviderName: personName(billingProvider),
      billingProviderNpi: String(billingProvider?.individual_npi ?? ""),
      cptCodes,
      modifiers,
      diagnosisCodes,
      submittedAt: String(claim?.submitted_at ?? ""),
      authorizationNumber: String(authorization?.authorization_number ?? ""),
      authorizationStartDate: String(authorization?.start_date ?? ""),
      authorizationEndDate: String(authorization?.end_date ?? ""),
      clinicalDurationMinutes: Number.isFinite(clinicalDurationMinutes) ? clinicalDurationMinutes : null,
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
