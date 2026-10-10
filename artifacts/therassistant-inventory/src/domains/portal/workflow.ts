import type { Row } from "../../lib/tenant-data-client";

export type PortalRow = Row & { id: string };

export type PortalDataInput = {
  patient: PortalRow;
  appointments: PortalRow[];
  policies: PortalRow[];
  documents: PortalRow[];
  checkins: PortalRow[];
  journalEntries: PortalRow[];
  balance?: PortalRow | null;
  now?: Date;
};

export const PORTAL_ON_MY_WAY_WINDOW_MS = 4 * 60 * 60 * 1000;
export const PORTAL_ARRIVAL_WINDOW_MS = 60 * 60 * 1000;

const PORTAL_SERVICE_TIME_ZONE = "America/Denver";
const portalServiceDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PORTAL_SERVICE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function serviceDateKey(value: Date) {
  return portalServiceDateFormatter.format(value);
}

function isSameLocalServiceDate(left: Date, right: Date) {
  return serviceDateKey(left) === serviceDateKey(right);
}

function appointmentServiceDate(row: PortalRow) {
  const explicit = String(row.service_date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const startsAt = new Date(String(row.starts_at ?? ""));
  return Number.isFinite(startsAt.getTime()) ? serviceDateKey(startsAt) : "";
}

export function isPortalAppointmentAvailable(row: PortalRow, now = new Date()) {
  const status = String(row.appointment_status ?? "scheduled").toLowerCase();
  if (["cancelled", "no_show", "late_cancel", "completed", "rescheduled"].includes(status)) return false;

  const startsAt = new Date(String(row.starts_at ?? ""));
  if (!Number.isFinite(startsAt.getTime())) return false;
  if (startsAt >= now) return true;

  return appointmentServiceDate(row) === serviceDateKey(now);
}

export function getPortalArrivalStep(row: PortalRow, checkin: PortalRow | Record<string, unknown>, now = new Date()): CheckInStep | null {
  if (checkin.checked_in_at) return null;
  if (checkin.arrived_at) return "checked_in";
  if (checkin.on_my_way_at) return "arrived";

  const availability = getPortalArrivalAvailability(row, now);
  if (availability.arrival && !availability.onMyWay) return "arrived";
  return "on_my_way";
}

export function getPortalArrivalAvailability(row: PortalRow, now = new Date()) {
  const status = String(row.appointment_status ?? "scheduled").toLowerCase();
  if (["cancelled", "no_show", "late_cancel", "completed", "rescheduled", "in_session", "checked_in"].includes(status)) {
    return { onMyWay: false, arrival: false };
  }

  const startsAt = new Date(String(row.starts_at ?? ""));
  if (!Number.isFinite(startsAt.getTime())) return { onMyWay: false, arrival: false };

  if (startsAt <= now) {
    return appointmentServiceDate(row) === serviceDateKey(now)
      ? { onMyWay: false, arrival: true }
      : { onMyWay: false, arrival: false };
  }

  const untilStart = startsAt.getTime() - now.getTime();
  return {
    onMyWay: untilStart <= PORTAL_ON_MY_WAY_WINDOW_MS,
    arrival: untilStart <= PORTAL_ARRIVAL_WINDOW_MS,
  };
}

export function buildPatientPortalData(input: PortalDataInput) {
  const now = input.now ?? new Date();
  const upcomingAppointments = input.appointments
    .filter((row) => isPortalAppointmentAvailable(row, now))
    .sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")));

  const appointmentHistory = input.appointments
    .filter((row) => !isPortalAppointmentAvailable(row, now))
    .sort((a, b) => String(b.starts_at ?? "").localeCompare(String(a.starts_at ?? "")));

  const visibleDocuments = input.documents.filter((row) =>
    ["insurance_card", "intake_form", "consent_form", "client_correspondence", "statement"].includes(String(row.document_type ?? "")) &&
    !["rejected", "voided"].includes(String(row.document_status ?? "")),
  );

  return {
    patient: input.patient,
    upcomingAppointments,
    appointmentHistory,
    insurancePolicies: input.policies.filter((row) => row.status !== "terminated"),
    documents: visibleDocuments,
    checkins: input.checkins,
    journalEntries: input.journalEntries,
    openBalanceCents: Number(input.balance?.open_balance_cents ?? 0),
  };
}

export type CheckInStep = "on_my_way" | "arrived" | "checked_in";

export function planCheckInUpdate(step: CheckInStep, now = new Date()): Row {
  const timestamp = now.toISOString();
  if (step === "on_my_way") return { on_my_way_at: timestamp };
  if (step === "arrived") return { arrived_at: timestamp };
  return { checked_in_at: timestamp };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type PreVisitCheckInUpdate = {
  demographics_confirmed?: boolean;
  insurance_confirmed?: boolean;
  visit_questions?: Record<string, unknown>;
  consents?: Record<string, unknown>;
  submitted?: boolean;
};

export function buildPreVisitResponses(
  existingResponses: Record<string, unknown>,
  update: PreVisitCheckInUpdate,
  now = new Date(),
): Record<string, unknown> {
  const previousPreVisit = recordOf(existingResponses.pre_visit);
  const timestamp = now.toISOString();
  const nextPreVisit: Record<string, unknown> = {
    ...previousPreVisit,
    ...(update.demographics_confirmed !== undefined ? { demographics_confirmed: update.demographics_confirmed } : {}),
    ...(update.insurance_confirmed !== undefined ? { insurance_confirmed: update.insurance_confirmed } : {}),
    updated_at: timestamp,
  };

  if (update.visit_questions) {
    nextPreVisit.visit_questions_saved_at = timestamp;
    nextPreVisit.visit_questions = {
      ...recordOf(previousPreVisit.visit_questions),
      ...update.visit_questions,
    };
  }

  if (update.consents) {
    nextPreVisit.consents_saved_at = timestamp;
    nextPreVisit.consents = {
      ...recordOf(previousPreVisit.consents),
      ...update.consents,
    };
  }

  if (update.submitted === true) nextPreVisit.submitted_at = timestamp;

  return {
    ...existingResponses,
    pre_visit: nextPreVisit,
  };
}

export type JournalEntryInput = {
  entryText: string;
  mood?: string;
  visibility?: "private" | "shared_with_provider";
  tags?: string[];
  relatedTreatmentGoalId?: string;
  entryStatus?: "draft" | "submitted";
};

export function buildJournalEntryValues(input: JournalEntryInput, now = new Date()): Row {
  const text = input.entryText.trim();
  if (!text) throw new Error("Journal entry text is required.");

  const entryStatus = input.entryStatus ?? "submitted";
  return {
    entry_date: now.toISOString().slice(0, 10),
    entry_text: text,
    mood: input.mood?.trim() || null,
    author_type: "patient",
    review_status: "unreviewed",
    visibility: input.visibility ?? "shared_with_provider",
    tags: input.tags ?? [],
    related_treatment_goal_id: input.relatedTreatmentGoalId || null,
    entry_status: entryStatus,
    submitted_at: entryStatus === "submitted" ? now.toISOString() : null,
  };
}
