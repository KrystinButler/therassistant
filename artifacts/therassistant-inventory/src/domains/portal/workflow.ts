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

export function buildPatientPortalData(input: PortalDataInput) {
  const now = input.now ?? new Date();
  const upcomingAppointments = input.appointments
    .filter((row) => {
      const startsAt = new Date(String(row.starts_at ?? ""));
      return Number.isFinite(startsAt.getTime()) && startsAt >= now && !["cancelled", "no_show"].includes(String(row.appointment_status ?? ""));
    })
    .sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")));

  const visibleDocuments = input.documents.filter((row) =>
    ["insurance_card", "intake_form", "consent_form", "client_correspondence", "statement", "other"].includes(String(row.document_type ?? "")) &&
    !["rejected", "voided"].includes(String(row.document_status ?? "")),
  );

  return {
    patient: input.patient,
    upcomingAppointments,
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
    nextPreVisit.visit_questions = {
      ...recordOf(previousPreVisit.visit_questions),
      ...update.visit_questions,
    };
  }

  if (update.consents) {
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
