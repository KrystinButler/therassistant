import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { evaluatePreSession } from "../readiness/evaluate-pre-session";
import { isVerifiedEligibilitySource } from "../eligibility/workflow";
import type { PreSessionReadiness } from "../readiness/types";
import {
  buildAppointmentInput,
  buildSchedulePatientPresentation,
  type AppointmentDraft,
  type ScheduleCheckInStatus,
  type SchedulePreVisitInsight,
} from "./workflow";

type DataRow = Row & { id: string };

export type ScheduleAppointment = {
  id: string;
  clientId: string;
  clientName: string;
  billingType: string;
  providerId: string | null;
  providerName: string;
  payerId: string | null;
  payerName: string;
  planName: string;
  policyId: string | null;
  memberId: string;
  startsAt: string;
  endsAt: string;
  appointmentStatus: string;
  locationType: string;
  serviceType: string;
  cptCode: string;
  registrationStatus: string;
  eligibilityStatus: string | null;
  providerEnrollmentStatus: string | null;
  treatmentPlanStatus: string | null;
  treatmentPlanReviewDueDate: string | null;
  checkInStatus: ScheduleCheckInStatus;
  preVisitInsights: SchedulePreVisitInsight[];
  sessionFocus: string | null;
  readiness: PreSessionReadiness;
};

export type ScheduleData = {
  appointments: ScheduleAppointment[];
  clients: DataRow[];
  providers: DataRow[];
};

function name(row?: Row | null) {
  if (!row) return "—";
  const display = String(row.display_name ?? "").trim();
  if (display) return display;
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function metadata(row?: Row | null) {
  const value = row?.metadata;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function byId(rows: DataRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function primaryPolicy(policies: DataRow[], clientId: string) {
  const patientPolicies = policies.filter((row) => row.client_id === clientId);
  return (
    patientPolicies.find(
      (row) => row.status === "active" && row.insurance_order === "primary",
    ) ??
    patientPolicies.find((row) => row.status === "active") ??
    patientPolicies[0] ??
    null
  );
}

function latestEligibility(
  rows: DataRow[],
  clientId: string,
  policyId: string | null,
  serviceDate: string,
) {
  const verified = rows
    .filter(
      (row) =>
        row.client_id === clientId &&
        (!policyId || row.insurance_policy_id === policyId) &&
        isVerifiedEligibilitySource(row.response_source),
    )
    .sort((a, b) => {
      const aExact = String(a.service_date ?? "") === serviceDate;
      const bExact = String(b.service_date ?? "") === serviceDate;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      return String(b.created_at ?? b.updated_at ?? "").localeCompare(
        String(a.created_at ?? a.updated_at ?? ""),
      );
    });
  return verified[0] ?? null;
}

function currentTreatmentPlan(
  rows: DataRow[],
  clientId: string,
  serviceDate: string,
) {
  return rows
    .filter((row) => {
      if (row.client_id !== clientId) return false;
      const effectiveDate = String(row.effective_date ?? "");
      return !effectiveDate || effectiveDate <= serviceDate;
    })
    .sort((a, b) => {
      const aCurrent = ["active", "signed"].includes(String(a.status ?? ""));
      const bCurrent = ["active", "signed"].includes(String(b.status ?? ""));
      if (aCurrent && !bCurrent) return -1;
      if (bCurrent && !aCurrent) return 1;
      return String(b.effective_date ?? b.created_at ?? "").localeCompare(
        String(a.effective_date ?? a.created_at ?? ""),
      );
    })[0] ?? null;
}

export async function getScheduleData(): Promise<ScheduleData> {
  const [
    appointments,
    clients,
    providers,
    policies,
    eligibility,
    enrollments,
    treatmentPlans,
    checkins,
    journalEntries,
    balances,
    payers,
    plans,
  ] = await Promise.all([
    tenantSelect<DataRow>("appointments", { order: "starts_at.asc" }),
    tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    tenantSelect<DataRow>("client_insurance_policies"),
    tenantSelect<DataRow>("eligibility_checks"),
    tenantSelect<DataRow>("provider_payer_enrollments"),
    tenantSelect<DataRow>("treatment_plans"),
    tenantSelect<DataRow>("client_checkins"),
    tenantSelect<DataRow>("patient_journal_entries", { order: "entry_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("client_balance_summaries"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    referenceSelect<DataRow>("payer_plans", { order: "name.asc" }),
  ]);

  const clientsById = byId(clients);
  const providersById = byId(providers);
  const payersById = byId(payers);
  const plansById = byId(plans);
  const checkinsByAppointment = new Map(
    checkins.map((row) => [String(row.appointment_id ?? ""), row]),
  );
  const balancesByClient = new Map(
    balances.map((row) => [String(row.client_id ?? ""), row]),
  );
  const clientsWithSharedJournal = new Set(
    journalEntries
      .filter((row) =>
        String(row.visibility ?? "") === "shared_with_provider" &&
        String(row.entry_status ?? "submitted") !== "draft" &&
        Boolean(String(row.entry_text ?? "").trim()),
      )
      .map((row) => String(row.client_id ?? "")),
  );

  const enriched = appointments.map((appointment): ScheduleAppointment => {
    const clientId = String(appointment.client_id ?? "");
    const client = clientsById.get(clientId);
    const billingType = String(metadata(client).billing_type ?? "insurance");
    const providerId = appointment.provider_id ? String(appointment.provider_id) : null;
    const policy = primaryPolicy(policies, clientId);
    const payerId = policy?.payer_id ? String(policy.payer_id) : null;
    const serviceDate = String(appointment.starts_at ?? "").slice(0, 10);
    const eligibilityRow = latestEligibility(
      eligibility,
      clientId,
      policy?.id ?? null,
      serviceDate,
    );
    const enrollment = enrollments.find(
      (row) =>
        row.provider_id === providerId &&
        row.payer_id === payerId,
    );
    const treatmentPlan = currentTreatmentPlan(treatmentPlans, clientId, serviceDate);
    const checkin = checkinsByAppointment.get(appointment.id) ?? null;
    const openBalanceCents = Number(
      balancesByClient.get(clientId)?.open_balance_cents ?? 0,
    );
    const patientPresentation = buildSchedulePatientPresentation(
      checkin,
      openBalanceCents,
      clientsWithSharedJournal.has(clientId),
    );

    const readiness = evaluatePreSession({
      billingType,
      policy: policy ? { status: String(policy.status ?? "unknown") } : null,
      eligibility: eligibilityRow
        ? {
            eligibility_status: String(eligibilityRow.eligibility_status ?? ""),
            service_date: eligibilityRow.service_date
              ? String(eligibilityRow.service_date)
              : null,
          }
        : null,
      providerEnrollmentStatus: enrollment
        ? String(enrollment.enrollment_status ?? "unknown")
        : null,
      treatmentPlan: treatmentPlan
        ? {
            status: String(treatmentPlan.status ?? "draft"),
            review_due_date: treatmentPlan.review_due_date
              ? String(treatmentPlan.review_due_date)
              : null,
          }
        : null,
      serviceDate,
    });

    return {
      id: appointment.id,
      clientId,
      clientName: name(client),
      billingType,
      providerId,
      providerName: name(providerId ? providersById.get(providerId) : null),
      payerId,
      payerName: billingType === "self_pay" ? "Self Pay" : payerId ? String(payersById.get(payerId)?.name ?? "—") : "—",
      planName: policy?.payer_plan_id
        ? String(plansById.get(String(policy.payer_plan_id))?.name ?? "—")
        : "—",
      policyId: policy?.id ?? null,
      memberId: String(policy?.member_id ?? ""),
      startsAt: String(appointment.starts_at ?? ""),
      endsAt: String(appointment.ends_at ?? ""),
      appointmentStatus: String(appointment.appointment_status ?? "scheduled"),
      locationType: String(appointment.location_type ?? ""),
      serviceType: String(appointment.service_type ?? ""),
      cptCode: String(appointment.cpt_code ?? ""),
      registrationStatus: String(
        clientsById.get(clientId)?.registration_status ?? "not_started",
      ),
      eligibilityStatus: eligibilityRow
        ? String(eligibilityRow.eligibility_status ?? "")
        : null,
      providerEnrollmentStatus: enrollment
        ? String(enrollment.enrollment_status ?? "unknown")
        : null,
      treatmentPlanStatus: treatmentPlan
        ? String(treatmentPlan.status ?? "draft")
        : null,
      treatmentPlanReviewDueDate: treatmentPlan?.review_due_date
        ? String(treatmentPlan.review_due_date)
        : null,
      checkInStatus: patientPresentation.checkInStatus,
      preVisitInsights: patientPresentation.preVisitInsights,
      sessionFocus: patientPresentation.sessionFocus,
      readiness,
    };
  });

  return { appointments: enriched, clients, providers };
}

export async function getPreSessionData(appointmentId: string) {
  const data = await getScheduleData();
  const appointment = data.appointments.find((row) => row.id === appointmentId);
  if (!appointment) throw new Error("Appointment not found.");
  return { appointment, clients: data.clients, providers: data.providers };
}

export async function createAppointment(draft: AppointmentDraft) {
  if (!draft.clientId) throw new Error("Select a patient.");
  if (!draft.providerId) throw new Error("Select a provider.");
  return tenantInsert<DataRow>("appointments", buildAppointmentInput(draft));
}

export async function updateAppointmentStatus(id: string, status: string) {
  const values: Row = { appointment_status: status };
  if (status === "completed") values.completed_at = new Date().toISOString();
  return tenantUpdate<DataRow>("appointments", id, values);
}
