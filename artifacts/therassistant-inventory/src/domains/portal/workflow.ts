import type { Row } from "../../lib/supabase-demo-client";

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

export type JournalEntryDraft = {
  entryText: string;
  mood?: string;
  tags?: string[];
  relatedGoalId?: string | null;
  visibility?: "private" | "shared_with_provider";
  entryStatus?: "draft" | "submitted";
};

export function buildJournalEntryValues(input: JournalEntryDraft): Row {
  const text = input.entryText.trim();
  if (!text) throw new Error("Journal entry text is required.");

  const entryStatus = input.entryStatus ?? "submitted";
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];

  return {
    entry_text: text,
    mood: input.mood?.trim() || null,
    author_type: "patient",
    review_status: "unreviewed",
    visibility: input.visibility ?? "shared_with_provider",
    tags,
    related_treatment_goal_id: input.relatedGoalId || null,
    entry_status: entryStatus,
    submitted_at: entryStatus === "submitted" ? new Date().toISOString() : null,
  };
}

export type PortalAccessInput = {
  openBalanceCents: number;
  thresholdCents: number | null;
  activePaymentPlan: boolean;
  approvedException: boolean;
};

export type PortalAccessState = {
  restricted: boolean;
  reason: "balance_threshold" | null;
  openBalanceCents: number;
  thresholdCents: number | null;
};

export function evaluatePortalAccess(input: PortalAccessInput): PortalAccessState {
  const restricted =
    input.thresholdCents !== null &&
    input.openBalanceCents > input.thresholdCents &&
    !input.activePaymentPlan &&
    !input.approvedException;

  return {
    restricted,
    reason: restricted ? "balance_threshold" : null,
    openBalanceCents: input.openBalanceCents,
    thresholdCents: input.thresholdCents,
  };
}

export function mergePreVisitResponses(
  current: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base = current && typeof current === "object"
    ? { ...(current as Record<string, unknown>) }
    : {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    base[key] = value;
  }

  return base;
}
