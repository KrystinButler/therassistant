import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import { evaluatePreSession } from "../readiness/evaluate-pre-session";
import type { PreSessionReadiness } from "../readiness/types";
import {
  buildPatientReviewContext,
  type PatientReviewContext,
} from "./patient-review";
import { buildAppointmentInput, syntheticEligibilityStatus, type AppointmentDraft } from "./workflow";

type DataRow = Row & { id: string };

export type ScheduleAppointment = {
  id: string;
  clientId: string;
  clientName: string;
  clientPronouns: string | null;
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
  readiness: PreSessionReadiness;
  patientReview: PatientReviewContext;
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

function checkinForAppointment(rows: DataRow[], appointmentId: string) {
  return rows
    .filter((row) => row.appointment_id === appointmentId)
    .sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null;
}

function journalsForClient(rows: DataRow[], clientId: string) {
  return rows.filter((row) => row.client_id === clientId);
}

function activeGoalForPlan(rows: DataRow[], treatmentPlanId: string | null) {
  if (!treatmentPlanId) return null;
  const planGoals = rows.filter((row) => row.treatment_plan_id === treatmentPlanId);
  return (
    planGoals.find((row) =>
      ["active", "in_progress", "on_track"].includes(String(row.status ?? "")),
    ) ??
    planGoals[0] ??
    null
  );
}

function latestPriorEncounter(
  rows: DataRow[],
  clientId: string,
  appointmentStart: string,
) {
  return rows
    .filter((row) => {
      if (row.client_id !== clientId) return false;
      const startedAt = String(row.started_at ?? "");
      return Boolean(startedAt) && startedAt < appointmentStart;
    })
    .sort((a, b) =>
      String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")),
    )[0] ?? null;
}

function latestNoteForEncounter(rows: DataRow[], encounterId: string) {
  return rows
    .filter((row) => row.encounter_id === encounterId)
    .sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null;
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
    treatmentGoals,
    checkins,
    journalEntries,
    encounters,
    notes,
    payers,
    plans,
  ] = await Promise.all([
    demoSelect<DataRow>("appointments", { order: "starts_at.asc" }),
    demoSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    demoSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    demoSelect<DataRow>("client_insurance_policies"),
    demoSelect<DataRow>("eligibility_checks"),
    demoSelect<DataRow>("authorizations"),
    demoSelect<DataRow>("authorization_units"),
    demoSelect<DataRow>("provider_payer_enrollments"),
    demoSelect<DataRow>("treatment_plans"),
    demoSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
    demoSelect<DataRow>("client_checkins"),
    demoSelect<DataRow>("patient_journal_entries", {
      order: "entry_date.desc,created_at.desc",
    }),
    demoSelect<DataRow>("encounters", { order: "started_at.desc" }),
    demoSelect<DataRow>("clinical_notes", { order: "created_at.desc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    referenceSelect<DataRow>("payer_plans", { order: "name.asc" }),
  ]);

  const clientsById = byId(clients);
  const providersById = byId(providers);
  const payersById = byId(payers);
  const plansById = byId(plans);

  const enriched = appointments.map((appointment): ScheduleAppointment => {
    const clientId = String(appointment.client_id ?? "");
    const client = clientsById.get(clientId);
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
    const appointmentStart = String(appointment.starts_at ?? "");
    const treatmentPlan = currentTreatmentPlan(treatmentPlans, clientId, serviceDate);
    const activeGoal = activeGoalForPlan(
      treatmentGoals,
      treatmentPlan?.id ?? null,
    );
    const checkin = checkinForAppointment(checkins, appointment.id);
    const priorEncounter = latestPriorEncounter(encounters, clientId, appointmentStart);
    const priorNote = priorEncounter
      ? latestNoteForEncounter(notes, priorEncounter.id)
      : null;
    const patientReview = buildPatientReviewContext({
      checkin,
      journals: journalsForClient(journalEntries, clientId),
      activeGoal,
      priorNote,
    });

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
      clientName: name(client),
      clientPronouns: String(client?.pronouns ?? "").trim() || null,
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
        client?.registration_status ?? "not_started",
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
      readiness,
      patientReview,
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
  return demoInsert<DataRow>("appointments", buildAppointmentInput(draft));
}

export async function updateAppointmentStatus(id: string, status: string) {
  const values: Row = { appointment_status: status };
  if (status === "completed") values.completed_at = new Date().toISOString();
  return demoUpdate<DataRow>("appointments", id, values);
}

export async function runEligibility(appointmentId: string) {
  const { appointment } = await getPreSessionData(appointmentId);
  if (!appointment.policyId || !appointment.payerId || !appointment.memberId) {
    throw new Error("Add a primary insurance policy before running eligibility.");
  }

  const status = syntheticEligibilityStatus(appointment.memberId);
  const serviceDate = appointment.startsAt.slice(0, 10);

  return demoInsert<DataRow>("eligibility_checks", {
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
