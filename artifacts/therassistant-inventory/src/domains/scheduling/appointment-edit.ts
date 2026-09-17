import { tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { buildAppointmentInput, type AppointmentDraft } from "./workflow";

type DataRow = Row & { id: string };

export function updateAppointment(id: string, draft: AppointmentDraft) {
  if (!id) throw new Error("Appointment is required.");
  if (!draft.clientId) throw new Error("Select a patient.");
  if (!draft.providerId) throw new Error("Select a provider.");
  return tenantUpdate<DataRow>("appointments", id, buildAppointmentInput(draft));
}
