import { readScreeners, screenerTotal } from "../portal/portal-screeners";
type AnyRow = Record<string, unknown>;

function recordOf(value: unknown): AnyRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRow
    : {};
}

function text(row: AnyRow | null | undefined, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function list(row: AnyRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value === "string" && value.trim()) {
      return value.split(/\n|•|;/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function legacySafetyConcern(row?: AnyRow | null) {
  const concern = row?.safety_concerns ?? row?.safety_concern ?? row?.risk_flag;
  if (concern === true) return true;
  if (concern === false) return false;
  const risk = text(row, ["risk_level", "safety_status"]).toLowerCase();
  if (["high", "elevated", "concern", "concerns", "unsafe"].includes(risk)) return true;
  if (["none", "low", "no concerns", "safe"].includes(risk)) return false;
  return null;
}

export function appointmentCheckIn<T extends AnyRow>(rows: T[], appointmentId: string): T | null {
  return rows.find(row => String(row.appointment_id ?? "") === appointmentId) ?? null;
}

export type PatientReviewCheckIn = {
  focus: string;
  mood: string;
  changes: string[];
  treatmentGoal: string;
  additionalContext: string;
  safetyText: string;
  safetyConcern: boolean | null;
  phq9Total?: number | null;
  gad7Total?: number | null;
  phq9Item9?: number | null;
  screenersDeclined?: boolean;
  hasScreeners?: boolean;
  planReview?: string;
  goalUpdates?: Array<{goalId:string;goalText:string;progress:string;barriers:string}>;
  submittedAt?: string;
  hasSubmittedPreVisit: boolean;
  hasSubmittedSafetyScreener: boolean;
};

export function buildPatientReviewCheckIn(checkin: AnyRow | null | undefined): PatientReviewCheckIn {
  const responses = recordOf(checkin?.responses);
  const preVisit = recordOf(responses.pre_visit);
  const hasSubmittedPreVisit =
    typeof preVisit.submitted_at === "string" && preVisit.submitted_at.trim().length > 0;
  const questions = hasSubmittedPreVisit ? recordOf(preVisit.visit_questions) : {};

  const focus = text(
    questions,
    ["focus_today"],
    text(checkin, ["focus_today", "session_focus", "focus", "primary_focus"]),
  );
  const mood = text(
    questions,
    ["feeling_since_last_visit"],
    text(checkin, ["mood", "mood_text", "current_mood", "response_summary"]),
  );
  const changes = list(questions, ["important_changes"]);
  const legacyChanges = list(checkin, ["recent_changes", "changes", "updates"]);
  const treatmentGoal = text(questions, ["treatment_goal"]);
  const additionalContext = text(questions, ["anything_else"]);
  const safetyText = text(questions, ["safety_concerns"]);

  const screeners = readScreeners(questions.screeners);
  return {
    phq9Total: screenerTotal(screeners.phq9, 9),
    gad7Total: screenerTotal(screeners.gad7, 7),
    phq9Item9: screeners.phq9[8],
    screenersDeclined: screeners.declined,
    hasScreeners: Boolean(questions.screeners),
    planReview: text(recordOf(questions.treatment_plan_review), ["status"]),
    submittedAt: hasSubmittedPreVisit ? String(preVisit.submitted_at) : "",
    goalUpdates: Array.isArray(questions.goal_updates) ? questions.goal_updates.map(value => {
      const goal = recordOf(value);
      return {goalId:text(goal,["goal_id"]),goalText:text(goal,["goal_text"]),progress:text(goal,["progress"]),barriers:text(goal,["barriers"])};
    }) : [],
    focus,
    mood,
    changes: changes.length ? changes : legacyChanges,
    treatmentGoal,
    additionalContext,
    safetyText,
    safetyConcern: safetyText ? null : legacySafetyConcern(checkin),
    hasSubmittedPreVisit,
    hasSubmittedSafetyScreener: hasSubmittedPreVisit && recordOf(questions.screeners).declined !== true && Array.isArray(recordOf(questions.screeners).cssrs) && [0,1,5].every(index => typeof (recordOf(questions.screeners).cssrs as unknown[])[index] === "boolean"),
  };
}
