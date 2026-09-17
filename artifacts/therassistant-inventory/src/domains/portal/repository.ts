import {
  portalInsert,
  portalSelect,
  portalUpdate,
  type PortalRow as DataValue,
} from "../../lib/portal-public-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  buildPreVisitResponses,
  planCheckInUpdate,
  type CheckInStep,
  type JournalEntryInput,
  type PortalRow,
  type PreVisitCheckInUpdate,
} from "./workflow";

type DataRow = DataValue & { id: string };

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function recordCheckIn(
  appointmentId: string,
  patientId: string,
  step: CheckInStep,
  responses?: Record<string, unknown>,
) {
  const existing = await portalSelect<DataRow>("client_checkins", patientId, {
    appointment_id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  const values: DataValue = {
    ...planCheckInUpdate(step),
    ...(responses ? { responses } : {}),
  };
  return existing[0]
    ? portalUpdate<DataRow>("client_checkins", patientId, existing[0].id, values)
    : portalInsert<DataRow>("client_checkins", patientId, {
        appointment_id: appointmentId,
        client_id: patientId,
        responses: responses ?? {},
        ...values,
      });
}

export async function savePreVisitCheckIn(
  appointmentId: string,
  patientId: string,
  update: PreVisitCheckInUpdate,
) {
  const existing = await portalSelect<DataRow>("client_checkins", patientId, {
    appointment_id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  const responses = buildPreVisitResponses(recordOf(existing[0]?.responses), update);

  return existing[0]
    ? portalUpdate<DataRow>("client_checkins", patientId, existing[0].id, { responses })
    : portalInsert<DataRow>("client_checkins", patientId, {
        appointment_id: appointmentId,
        client_id: patientId,
        responses,
      });
}

export function addJournalEntry(patientId: string, input: JournalEntryInput) {
  return portalInsert<DataRow>("patient_journal_entries", patientId, {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export async function getPatientPortalData(patientId: string) {
  const [patients, appointments, policies, documents, checkins, journalEntries, balances, treatmentPlans] = await Promise.all([
    portalSelect<DataRow>("clients", patientId, { id: `eq.${patientId}`, limit: "1" }),
    portalSelect<DataRow>("appointments", patientId, { client_id: `eq.${patientId}`, order: "starts_at.asc" }),
    portalSelect<DataRow>("client_insurance_policies", patientId, { client_id: `eq.${patientId}`, order: "created_at.asc" }),
    portalSelect<DataRow>("documents", patientId, { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    portalSelect<DataRow>("client_checkins", patientId, { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    portalSelect<DataRow>("patient_journal_entries", patientId, { client_id: `eq.${patientId}`, order: "entry_date.desc,created_at.desc" }),
    portalSelect<DataRow>("client_balance_summaries", patientId, { client_id: `eq.${patientId}`, limit: "1" }),
    portalSelect<DataRow>("treatment_plans", patientId, { client_id: `eq.${patientId}`, order: "effective_date.desc" }),
  ]);

  const patient = patients[0];
  if (!patient) throw new Error("Patient not found.");

  const portalData = buildPatientPortalData({
    patient: patient as PortalRow,
    appointments: appointments as PortalRow[],
    policies: policies as PortalRow[],
    documents: documents as PortalRow[],
    checkins: checkins as PortalRow[],
    journalEntries: journalEntries as PortalRow[],
    balance: (balances[0] as PortalRow | undefined) ?? null,
  });

  const activePlan = treatmentPlans.find((row) => String(row.status ?? "") === "active") ?? treatmentPlans[0];
  const providerId = String(portalData.upcomingAppointments[0]?.provider_id ?? activePlan?.provider_id ?? "");

  const [treatmentGoals, providers] = await Promise.all([
    activePlan
      ? portalSelect<DataRow>("treatment_plan_goals", patientId, { treatment_plan_id: `eq.${activePlan.id}`, order: "created_at.asc" })
      : Promise.resolve([] as DataRow[]),
    providerId
      ? portalSelect<DataRow>("providers", patientId, { id: `eq.${providerId}`, limit: "1" })
      : Promise.resolve([] as DataRow[]),
  ]);

  return {
    ...portalData,
    treatmentGoals,
    provider: providers[0] ?? null,
  };
}
