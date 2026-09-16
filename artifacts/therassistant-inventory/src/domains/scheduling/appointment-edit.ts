import { demoUpdate, type Row } from "../../lib/supabase-demo-client";
import { buildAppointmentInput, type AppointmentDraft } from "./workflow";

type DataRow = Row & { id: string };

export function updateAppointment(id: string, draft: AppointmentDraft) {
  if (!id) throw new Error("Appointment is required.");
  if (!draft.clientId) throw new Error("Select a patient.");
  if (!draft.providerId) throw new Error("Select a provider.");
  return demoUpdate<DataRow>("appointments", id, buildAppointmentInput(draft));
}
