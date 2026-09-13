import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  planCheckInUpdate,
  type CheckInStep,
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

export function addJournalEntry(patientId: string, input: { entryText: string; mood?: string }) {
  return demoInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export async function getPatientPortalData(patientId: string) {
  const [patients, appointments, policies, documents, checkins, journalEntries, balances] = await Promise.all([
    demoSelect<DataRow>("clients", { id: `eq.${patientId}`, limit: "1" }),
    demoSelect<DataRow>("appointments", { client_id: `eq.${patientId}`, order: "starts_at.asc" }),
    demoSelect<DataRow>("client_insurance_policies", { client_id: `eq.${patientId}`, order: "created_at.asc" }),
    demoSelect<DataRow>("documents", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("client_checkins", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("patient_journal_entries", { client_id: `eq.${patientId}`, order: "entry_date.desc,created_at.desc" }),
    demoSelect<DataRow>("client_balance_summaries", { client_id: `eq.${patientId}`, limit: "1" }),
  ]);

  const patient = patients[0];
  if (!patient) throw new Error("Patient not found.");

  return buildPatientPortalData({
    patient: patient as PortalRow,
    appointments: appointments as PortalRow[],
    policies: policies as PortalRow[],
    documents: documents as PortalRow[],
    checkins: checkins as PortalRow[],
    journalEntries: journalEntries as PortalRow[],
    balance: (balances[0] as PortalRow | undefined) ?? null,
  });
}
