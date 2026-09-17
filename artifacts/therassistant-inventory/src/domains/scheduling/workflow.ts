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

export type ScheduleCheckInStatus =
  | "Not Checked-In"
  | "Ready"
  | "In Progress"
  | "Balance Issues";

export type SchedulePreVisitInsight = {
  label: string;
  value: string;
};

export type SchedulePatientPresentation = {
  checkInStatus: ScheduleCheckInStatus;
  preVisitInsights: SchedulePreVisitInsight[];
  sessionFocus: string | null;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildSchedulePatientPresentation(
  checkin: Record<string, unknown> | null,
  openBalanceCents: number,
): SchedulePatientPresentation {
  const responses = recordOf(checkin?.responses);
  const preVisit = recordOf(responses.pre_visit);
  const questions = recordOf(preVisit.visit_questions);

  const insightFields: Array<[string, string]> = [
    ["Since last visit", "feeling_since_last_visit"],
    ["Important changes", "important_changes"],
    ["Safety concerns", "safety_concerns"],
    ["Treatment goal", "treatment_goal"],
    ["Anything else", "anything_else"],
  ];

  const preVisitInsights = insightFields
    .map(([label, key]) => ({ label, value: textOf(questions[key]) }))
    .filter((insight) => insight.value.length > 0);

  const sessionFocus = textOf(questions.focus_today) || null;
  const checkInComplete = Boolean(preVisit.submitted_at || checkin?.checked_in_at);
  const checkInStarted = Boolean(
    checkin && (
      Object.keys(responses).length > 0 ||
      checkin.on_my_way_at ||
      checkin.arrived_at ||
      checkin.checked_in_at
    ),
  );

  let checkInStatus: ScheduleCheckInStatus = "Not Checked-In";
  if (openBalanceCents > 0) checkInStatus = "Balance Issues";
  else if (checkInComplete) checkInStatus = "Ready";
  else if (checkInStarted) checkInStatus = "In Progress";

  return { checkInStatus, preVisitInsights, sessionFocus };
}

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
