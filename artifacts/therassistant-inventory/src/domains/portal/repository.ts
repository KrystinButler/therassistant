import {
  getMyPortalContext,
  portalRpc,
  portalSelect,
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

function requireActivePortalContext(
  context: Awaited<ReturnType<typeof getMyPortalContext>>,
) {
  if (!context || context.status !== "active") {
    throw new Error("Active patient portal access is required.");
  }
  return context;
}

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
  const context = requireActivePortalContext(await getMyPortalContext());
  const patientId = context.client_id;

  const [
    patients,
    appointments,
    policies,
    documents,
    checkins,
    journalEntries,
    balances,
    treatmentPlans,
  ] = await Promise.all([
    portalSelect<DataRow>("clients", {
      id: `eq.${patientId}`,
      limit: "1",
    }),
    portalSelect<DataRow>("appointments", {
      client_id: `eq.${patientId}`,
      order: "starts_at.asc",
    }),
    portalSelect<DataRow>("client_insurance_policies", {
      client_id: `eq.${patientId}`,
      order: "created_at.asc",
    }),
    portalSelect<DataRow>("documents", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
    portalSelect<DataRow>("client_checkins", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
    portalSelect<DataRow>("patient_journal_entries", {
      client_id: `eq.${patientId}`,
      order: "entry_date.desc,created_at.desc",
    }),
    portalSelect<DataRow>("client_balance_summaries", {
      client_id: `eq.${patientId}`,
      limit: "1",
    }),
    portalSelect<DataRow>("treatment_plans", {
      client_id: `eq.${patientId}`,
      order: "effective_date.desc",
    }),
  ]);

  const patient = patients[0];
  if (!patient) throw new Error("Patient portal profile is unavailable.");

  const portalData = buildPatientPortalData({
    patient: patient as PortalRow,
    appointments: appointments as PortalRow[],
    policies: policies as PortalRow[],
    documents: documents as PortalRow[],
    checkins: checkins as PortalRow[],
    journalEntries: journalEntries as PortalRow[],
    balance: (balances[0] as PortalRow | undefined) ?? null,
  });

  const activePlan =
    treatmentPlans.find((row) => String(row.status ?? "") === "active")
    ?? treatmentPlans[0];

  const [treatmentGoals, provider] = await Promise.all([
    activePlan
      ? portalSelect<DataRow>("treatment_plan_goals", {
          treatment_plan_id: `eq.${activePlan.id}`,
          order: "created_at.asc",
        })
      : Promise.resolve([] as DataRow[]),
    portalRpc<DataRow | null>("get_my_portal_provider_summary"),
  ]);

  return {
    ...portalData,
    treatmentGoals,
    provider,
  };
}
