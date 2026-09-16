import {
  normalizePreVisitResponses,
  type PreVisitResponses,
} from "../portal/check-in-contract.ts";

type ReviewRow = Record<string, unknown> & { id?: string };

export type PatientReviewContext = {
  checkInStatus: "Ready" | "In Progress" | "Not Checked In";
  checkInResponses: PreVisitResponses;
  latestSharedJournal: null | {
    id: string;
    createdAt: string;
    mood: string | null;
    text: string;
  };
  activeGoal: null | {
    id: string;
    text: string;
    status: string;
    targetDate: string | null;
  };
  priorSessionPlan: string | null;
  sessionFocus: string;
  preVisitInsight: string;
  safetySummary: string;
  hasSafetyConcern: boolean;
};

export type PatientReviewInput = {
  checkin?: ReviewRow | null;
  journals?: ReviewRow[];
  activeGoal?: ReviewRow | null;
  priorNote?: ReviewRow | null;
};

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(row: ReviewRow) {
  return nonEmpty(row.entry_date) ?? nonEmpty(row.created_at) ?? "";
}

function isSharedJournal(row: ReviewRow) {
  if (row.share_with_provider === true) return true;
  return String(row.visibility ?? "").toLowerCase() === "shared_with_provider";
}

function latestSharedJournal(rows: ReviewRow[]) {
  const row = rows
    .filter(isSharedJournal)
    .sort((a, b) => timestamp(b).localeCompare(timestamp(a)))[0];
  if (!row) return null;

  const text = nonEmpty(row.entry_text);
  if (!text) return null;

  return {
    id: String(row.id ?? ""),
    createdAt: timestamp(row),
    mood: nonEmpty(row.mood),
    text,
  };
}

function goalContext(row?: ReviewRow | null) {
  if (!row) return null;
  const text = nonEmpty(row.goal_text) ?? nonEmpty(row.objective_text) ?? nonEmpty(row.title);
  if (!text) return null;
  return {
    id: String(row.id ?? ""),
    text,
    status: nonEmpty(row.status) ?? "unknown",
    targetDate: nonEmpty(row.target_date),
  };
}

function priorPlan(row?: ReviewRow | null) {
  if (!row) return null;
  return nonEmpty(row.plan_text) ?? nonEmpty(row.plan) ?? nonEmpty(row.goal_addressed);
}

function hasSafetyConcernText(value?: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replace(/[.]+$/, "");
  return !new Set([
    "no",
    "none",
    "no concerns",
    "no safety concerns",
    "no safety concerns reported",
  ]).has(normalized);
}

export function deriveCheckInDisplay(
  checkin?: ReviewRow | null,
): "Ready" | "In Progress" | "Not Checked In" {
  if (checkin?.checked_in_at) return "Ready";
  if (checkin?.arrived_at || checkin?.on_my_way_at) return "In Progress";
  return "Not Checked In";
}

export function buildPatientReviewContext(
  input: PatientReviewInput,
): PatientReviewContext {
  const responses = normalizePreVisitResponses(input.checkin?.responses);
  const journal = latestSharedJournal(input.journals ?? []);
  const goal = goalContext(input.activeGoal);
  const plan = priorPlan(input.priorNote);
  const hasSafetyConcern = hasSafetyConcernText(responses.safetyConcerns);

  const sessionFocus =
    responses.focusToday ??
    responses.goalFocus ??
    goal?.text ??
    plan ??
    "Review progress and current needs.";

  const preVisitInsight =
    responses.moodSinceLastVisit ??
    responses.recentChanges ??
    (journal
      ? "Shared a journal entry before this visit."
      : "No new patient-reported update.");

  return {
    checkInStatus: deriveCheckInDisplay(input.checkin),
    checkInResponses: responses,
    latestSharedJournal: journal,
    activeGoal: goal,
    priorSessionPlan: plan,
    sessionFocus,
    preVisitInsight,
    safetySummary:
      responses.safetyConcerns ?? "No safety concerns reported.",
    hasSafetyConcern,
  };
}
