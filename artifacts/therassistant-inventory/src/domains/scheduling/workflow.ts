import { buildPatientReviewCheckIn } from "./patient-review-model";

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
  | "Not Checked In"
  | "Ready"
  | "In Progress"
  | "Balance Issues";

export type SchedulePreVisitInsight = {
  label: string;
  value: string;
  tone: "positive" | "warning" | "neutral";
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

function negativePatientSignal(mood: string, changes: string[], additionalContext: string, safetyConcern: boolean | null) {
  if (safetyConcern === true) return true;
  const reported = [mood, ...changes, additionalContext].join(" ").toLowerCase();
  return /\b(worse|worsened|struggling|overwhelmed|anxious|anxiety|panic|depressed|depression|sad|upset|angry|poor|difficult|hard|not good|declined)\b/.test(reported);
}

export function buildSchedulePatientPresentation(
  checkin: Record<string, unknown> | null,
  balanceIssue: boolean,
  journalShared = false,
): SchedulePatientPresentation {
  const responses = recordOf(checkin?.responses);
  const preVisit = recordOf(responses.pre_visit);
  const review = buildPatientReviewCheckIn(checkin);
  const preVisitInsights: SchedulePreVisitInsight[] = [];

  if (review.hasSubmittedPreVisit) {
    const negativeSignal = negativePatientSignal(
      review.mood,
      review.changes,
      review.additionalContext,
      review.safetyConcern,
    );
    preVisitInsights.push({
      label: "Check-In",
      value: negativeSignal ? "Negative" : "Positive",
      tone: negativeSignal ? "warning" : "positive",
    });
  }
  if (journalShared) {
    preVisitInsights.push({ label: "Journal", value: "Shared", tone: "neutral" });
  }

  const sessionFocus = review.focus || null;
  const checkInComplete = Boolean(preVisit.submitted_at || checkin?.checked_in_at);
  const checkInStarted = Boolean(
    checkin && (
      Object.keys(responses).length > 0 ||
      checkin.on_my_way_at ||
      checkin.arrived_at ||
      checkin.checked_in_at
    ),
  );

  let checkInStatus: ScheduleCheckInStatus = "Not Checked In";
  if (balanceIssue) checkInStatus = "Balance Issues";
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
