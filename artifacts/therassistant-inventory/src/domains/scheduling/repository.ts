import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { evaluatePreSession } from "../readiness/evaluate-pre-session";
import type { PreSessionReadiness } from "../readiness/types";
import {
  buildAppointmentInput,
  buildSchedulePatientPresentation,
  syntheticEligibilityStatus,
  type AppointmentDraft,
  type ScheduleCheckInStatus,
  type SchedulePreVisitInsight,
} from "./workflow";

type DataRow = Row & { id: string };

export type ScheduleAppointment = {
  id: string;
  clientId: string;
  clientName: string;
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
  authorizationRequired: boolean;
  authorizationStatus: string | null;
  authorizationNumber: string | null;
  remainingUnits: number | null;
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
) {
  return rows
    .filter(
      (row) =>
        row.client_id === clientId &&
        (!policyId || row.insurance_policy_id === policyId),
    )
    .sort((a, b) =>
      String(b.created_at ?? b.updated_at ?? "").localeCompare(
        String(a.created_at ?? a.updated_at ?? ""),
      ),
    )[0] ?? null;
}

function activeAuthorization(
  rows: DataRow[],
  clientId: string,
  payerId: string | null,
) {
  return rows
    .filter(
      (row) =>
        row.client_id === clientId &&
        (!payerId || row.payer_id === payerId),
    )
    .sort((a, b) => {
      if (a.status === "approved" && b.status !== "approved") return -1;
      if (b.status === "approved" && a.status !== "approved") return 1;
      return String(b.end_date ?? "").localeCompare(String(a.end_date ?? ""));
    })[0] ?? null;
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

function remainingUnitsFor(
  units: DataRow[],
  authorizationId: string | null,
  cptCode: string,
) {
  if (!authorizationId) return null;
  const relevant = units.filter(
    (row) =>
      row.authorization_id === authorizationId &&
      (!cptCode || !row.cpt_code || row.cpt_code === cptCode),
  );
  if (!relevant.length) return null;
  return relevant.reduce(
    (sum, row) => sum + Number(row.remaining_units ?? 0),
    0,
  );
}

export async function getScheduleData(): Promise<ScheduleData> {
  const [
    appointments,
    clients,
    providers,
    policies,
    eligibility,
    authorizations,
    authorizationUnits,
    enrollments,
    treatmentPlans,
    checkins,
    balances,
    payers,
    plans,
  ] = await Promise.all([
    tenantSelect<DataRow>("appointments", { order: "starts_at.asc" }),
    tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    tenantSelect<DataRow>("client_insurance_policies"),
    tenantSelect<DataRow>("eligibility_checks"),
    tenantSelect<DataRow>("authorizations"),
    tenantSelect<DataRow>("authorization_units"),
    tenantSelect<DataRow>("provider_payer_enrollments"),
    tenantSelect<DataRow>("treatment_plans"),
    tenantSelect<DataRow>("client_checkins"),
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

  const enriched = appointments.map((appointment): ScheduleAppointment => {
    const clientId = String(appointment.client_id ?? "");
    const providerId = appointment.provider_id ? String(appointment.provider_id) : null;
    const policy = primaryPolicy(policies, clientId);
    const payerId = policy?.payer_id ? String(policy.payer_id) : null;
    const eligibilityRow = latestEligibility(
      eligibility,
      clientId,
      policy?.id ?? null,
    );
    const policyMetadata = metadata(policy);
    const authorizationRequired = policyMetadata.authorization_required === true;
    const authorization = activeAuthorization(authorizations, clientId, payerId);
    const remainingUnits = remainingUnitsFor(
      authorizationUnits,
      authorization?.id ?? null,
      String(appointment.cpt_code ?? ""),
    );
    const enrollment = enrollments.find(
      (row) =>
        row.provider_id === providerId &&
        row.payer_id === payerId,
    );
    const serviceDate = String(appointment.starts_at ?? "").slice(0, 10);
    const treatmentPlan = currentTreatmentPlan(treatmentPlans, clientId, serviceDate);
    const checkin = checkinsByAppointment.get(appointment.id) ?? null;
    const openBalanceCents = Number(
      balancesByClient.get(clientId)?.open_balance_cents ?? 0,
    );
    const patientPresentation = buildSchedulePatientPresentation(
      checkin,
      openBalanceCents,
    );

    const readiness = evaluatePreSession({
      policy: policy ? { status: String(policy.status ?? "unknown") } : null,
      eligibility: eligibilityRow
        ? { eligibility_status: String(eligibilityRow.eligibility_status ?? "") }
        : null,
      authorizationRequired,
      authorization: authorization
        ? {
            status: String(authorization.status ?? "unknown"),
            remaining_units: remainingUnits,
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
      clientName: name(clientsById.get(clientId)),
      providerId,
      providerName: name(providerId ? providersById.get(providerId) : null),
      payerId,
      payerName: payerId ? String(payersById.get(payerId)?.name ?? "—") : "—",
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
      authorizationRequired,
      authorizationStatus: authorization
        ? String(authorization.status ?? "unknown")
        : null,
      authorizationNumber: authorization
        ? String(authorization.authorization_number ?? "") || null
        : null,
      remainingUnits,
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

export async function runEligibility(appointmentId: string) {
  const { appointment } = await getPreSessionData(appointmentId);
  if (!appointment.policyId || !appointment.payerId || !appointment.memberId) {
    throw new Error("Add a primary insurance policy before running eligibility.");
  }

  const status = syntheticEligibilityStatus(appointment.memberId);
  const serviceDate = appointment.startsAt.slice(0, 10);

  return tenantInsert<DataRow>("eligibility_checks", {
    client_id: appointment.clientId,
    insurance_policy_id: appointment.policyId,
    payer_id: appointment.payerId,
    service_date: serviceDate,
    eligibility_status: status,
    response_source: "synthetic_demo_270_271",
    raw_response: {
      demo: true,
      transaction: "271",
      member_id: appointment.memberId,
      outcome: status,
    },
    notes:
      status === "active"
        ? "Synthetic 270/271 response: active coverage."
        : `Synthetic 270/271 response: ${status.replaceAll("_", " ")}.`,
  });
}
