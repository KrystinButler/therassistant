import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  planCheckInUpdate,
  type CheckInStep,
  type JournalEntryInput,
  type PortalRow,
} from "./workflow";

type DataRow = Row & { id: string };

export async function recordCheckIn(
  appointmentId: string,
  patientId: string,
  step: CheckInStep,
  responses?: Record<string, unknown>,
) {
  const existing = await demoSelect<DataRow>("client_checkins", {
    appointment_id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  const values: Row = {
    ...planCheckInUpdate(step),
    ...(responses ? { responses } : {}),
  };
  return existing[0]
    ? demoUpdate<DataRow>("client_checkins", existing[0].id, values)
    : demoInsert<DataRow>("client_checkins", {
        appointment_id: appointmentId,
        client_id: patientId,
        responses: responses ?? {},
        ...values,
      });
}

export function addJournalEntry(patientId: string, input: JournalEntryInput) {
  return demoInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export async function getPatientPortalData(patientId: string) {
  const [patients, appointments, policies, documents, checkins, journalEntries, balances, treatmentPlans] = await Promise.all([
    demoSelect<DataRow>("clients", { id: `eq.${patientId}`, limit: "1" }),
    demoSelect<DataRow>("appointments", { client_id: `eq.${patientId}`, order: "starts_at.asc" }),
    demoSelect<DataRow>("client_insurance_policies", { client_id: `eq.${patientId}`, order: "created_at.asc" }),
    demoSelect<DataRow>("documents", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("client_checkins", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("patient_journal_entries", { client_id: `eq.${patientId}`, order: "entry_date.desc,created_at.desc" }),
    demoSelect<DataRow>("client_balance_summaries", { client_id: `eq.${patientId}`, limit: "1" }),
    demoSelect<DataRow>("treatment_plans", { client_id: `eq.${patientId}`, order: "effective_date.desc" }),
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
      ? demoSelect<DataRow>("treatment_plan_goals", { treatment_plan_id: `eq.${activePlan.id}`, order: "created_at.asc" })
      : Promise.resolve([] as DataRow[]),
    providerId
      ? demoSelect<DataRow>("providers", { id: `eq.${providerId}`, limit: "1" })
      : Promise.resolve([] as DataRow[]),
  ]);

  return {
    ...portalData,
    treatmentGoals,
    provider: providers[0] ?? null,
  };
}
