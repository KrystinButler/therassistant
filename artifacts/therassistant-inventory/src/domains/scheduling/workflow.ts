export { syntheticEligibilityStatus } from "../eligibility/workflow";

export type AppointmentDraft = {
  clientId: string;
  providerId?: string | null;
  date: string;
  time: string;
  durationMinutes?: number;
  locationType: "in_person" | "telehealth" | "phone" | "community" | "home" | "school" | "other";
  serviceType: string;
  cptCode?: string | null;
  notes?: string | null;
};

export function buildAppointmentInput(draft: AppointmentDraft) {
  const duration = draft.durationMinutes ?? 60;
  const startsAt = new Date(`${draft.date}T${draft.time}:00`);

  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Enter a valid appointment date and time.");
  }

  if (duration <= 0) {
    throw new Error("Appointment duration must be greater than zero.");
  }

  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  return {
    client_id: draft.clientId,
    provider_id: draft.providerId || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    appointment_status: "scheduled",
    location_type: draft.locationType,
    service_type: draft.serviceType,
    cpt_code: draft.cptCode || null,
    notes: draft.notes || null,
  };
}
