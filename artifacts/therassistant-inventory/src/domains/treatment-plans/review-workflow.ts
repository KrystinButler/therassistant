import type { Row } from "../../lib/tenant-data-client";
import { describeOutcomeTrend, type OutcomeTrend } from "../outcomes/workflow";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildReviewPeriod(effectiveDate?: string | null, endDate = new Date()) {
  const end = new Date(endDate);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  if (effectiveDate) {
    const effective = new Date(effectiveDate + "T12:00:00");
    if (Number.isFinite(effective.getTime()) && effective > start) start.setTime(effective.getTime());
  }
  return { start: isoDate(start), end: isoDate(end) };
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function goalReferenceCount(goal: Row, notes: Row[]) {
  const goalText = normalized(goal.goal_text);
  const objective = normalized(goal.objective_text);
  return notes.filter((note) => {
    const addressed = normalized(note.goal_addressed);
    if (!addressed) return false;
    if (goalText && (addressed === goalText || addressed.includes(goalText) || goalText.includes(addressed))) return true;
    if (objective && (addressed === objective || addressed.includes(objective) || objective.includes(addressed))) return true;
    return false;
  }).length;
}

export function buildGoalProgressSummary(goal: Row, sessionCount: number) {
  const label = String(goal.goal_text ?? "This goal");
  if (sessionCount === 0) {
    return "No signed clinical note in this review period explicitly linked the goal-addressed field to: " + label + ".";
  }
  return label + " was explicitly linked in " + sessionCount + " signed clinical note" + (sessionCount === 1 ? "" : "s") + " during this review period.";
}

export function buildReviewEvidenceSummary(input: {
  periodStart: string;
  periodEnd: string;
  signedSessionCount: number;
  structuredSessionCount: number;
  outcomeTrends: OutcomeTrend[];
}) {
  const parts = [
    "Review period: " + input.periodStart + " through " + input.periodEnd + ".",
    input.signedSessionCount + " signed or locked clinical session" + (input.signedSessionCount === 1 ? "" : "s") + " were found in the period.",
    "Structured click-to-note data was available for " + input.structuredSessionCount + " session" + (input.structuredSessionCount === 1 ? "" : "s") + ".",
  ];
  if (input.outcomeTrends.length) {
    parts.push("Recorded outcome-score changes: " + input.outcomeTrends.map(describeOutcomeTrend).join(" "));
  } else {
    parts.push("No PHQ-9 or GAD-7 scores were recorded during the review period.");
  }
  parts.push("This draft summarizes recorded chart data only and requires clinician interpretation, editing, and approval.");
  return parts.join(" ");
}

export function nextReviewDueDate(reviewEnd: string, days = 90) {
  const date = new Date(reviewEnd + "T12:00:00");
  if (!Number.isFinite(date.getTime())) throw new Error("Review end date is invalid.");
  date.setDate(date.getDate() + days);
  return isoDate(date);
}
