import {
  portalRpc,
  type PortalRow as DataValue,
} from "./portal-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  type CheckInStep,
  type JournalEntryInput,
  type PortalRow,
  type PreVisitCheckInUpdate,
} from "./workflow";

type DataRow = DataValue & { id: string };

type PatientPortalAggregate = {
  patient: PortalRow | null;
  appointments: PortalRow[];
  insurancePolicies: PortalRow[];
  documents: PortalRow[];
  checkins: PortalRow[];
  journalEntries: PortalRow[];
  balance: PortalRow | null;
  treatmentGoals: DataRow[];
};

export function recordCheckIn(
  appointmentId: string,
  step: CheckInStep,
) {
  return portalRpc<string>("record_client_checkin", {
    p_appointment_id: appointmentId,
    p_status: step,
    p_responses: {},
  });
}

export function savePreVisitCheckIn(
  appointmentId: string,
  update: PreVisitCheckInUpdate,
) {
  return portalRpc<DataRow>("portal_save_previsit_checkin", {
    p_appointment_id: appointmentId,
    p_update: update,
  });
}

export function addPortalJournalEntry(input: JournalEntryInput) {
  const values = buildJournalEntryValues(input);
  return portalRpc<DataRow>("portal_add_journal_entry", {
    p_entry_text: values.entry_text,
    p_mood: values.mood,
    p_visibility: values.visibility,
    p_tags: values.tags,
    p_related_treatment_goal_id: values.related_treatment_goal_id,
    p_entry_status: values.entry_status,
  });
}

export async function getPatientPortalData() {
  const [payload, provider] = await Promise.all([
    portalRpc<PatientPortalAggregate>("get_my_patient_portal_data"),
    portalRpc<DataRow | null>("get_my_portal_provider_summary"),
  ]);

  if (!payload.patient) {
    throw new Error("Patient portal profile is unavailable.");
  }

  const portalData = buildPatientPortalData({
    patient: payload.patient,
    appointments: payload.appointments,
    policies: payload.insurancePolicies,
    documents: payload.documents,
    checkins: payload.checkins,
    journalEntries: payload.journalEntries,
    balance: payload.balance,
  });

  return {
    ...portalData,
    treatmentGoals: payload.treatmentGoals,
    provider,
  };
}
