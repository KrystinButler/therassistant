import { tenantInsert, tenantRpc, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { buildOutcomeTrends } from "../outcomes/workflow";
import {
  buildGoalProgressSummary,
  buildReviewEvidenceSummary,
  buildReviewPeriod,
  goalReferenceCount,
} from "./review-workflow";
import {
  buildTreatmentGoalValues,
  buildTreatmentPlanValues,
  treatmentPlanAlert,
  type TreatmentGoalDraft,
  type TreatmentPlanDraft,
} from "./workflow";

type DataRow = Row & { id: string };

function inFilter(ids: string[]) {
  return "in.(" + ids.join(",") + ")";
}

export function createTreatmentPlan(patientId: string, input: TreatmentPlanDraft) {
  return tenantInsert<DataRow>("treatment_plans", { client_id: patientId, ...buildTreatmentPlanValues(input) });
}

export function updateTreatmentPlan(planId: string, input: TreatmentPlanDraft) {
  return tenantUpdate<DataRow>("treatment_plans", planId, buildTreatmentPlanValues(input));
}

export function addTreatmentGoal(planId: string, input: TreatmentGoalDraft) {
  return tenantInsert<DataRow>("treatment_plan_goals", { treatment_plan_id: planId, ...buildTreatmentGoalValues(input) });
}

export function updateTreatmentGoal(goalId: string, input: TreatmentGoalDraft) {
  return tenantUpdate<DataRow>("treatment_plan_goals", goalId, buildTreatmentGoalValues(input));
}

export async function getTreatmentPlanOptions() {
  return tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" });
}

export async function getTreatmentPlanWorkspace(patientId: string) {
  const [plans, goals] = await Promise.all([
    tenantSelect<DataRow>("treatment_plans", { client_id: "eq." + patientId, order: "effective_date.desc.nullslast,created_at.desc" }),
    tenantSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
  ]);
  const planIds = new Set(plans.map((row) => row.id));
  return plans.map((plan) => ({
    ...plan,
    goals: goals.filter((goal) => planIds.has(String(goal.treatment_plan_id)) && goal.treatment_plan_id === plan.id),
    alert: treatmentPlanAlert({ status: String(plan.status ?? "draft"), reviewDueDate: plan.review_due_date ? String(plan.review_due_date) : null }),
  }));
}

export async function getTreatmentPlanReviews(patientId: string) {
  const reviews = await tenantSelect<DataRow>("treatment_plan_reviews", {
    client_id: "eq." + patientId,
    order: "review_period_end.desc,created_at.desc",
  });
  if (!reviews.length) return [];
  const reviewIds = reviews.map((row) => row.id);
  const goals = await tenantSelect<DataRow>("treatment_plan_review_goals", {
    treatment_plan_review_id: inFilter(reviewIds),
    order: "created_at.asc",
  });
  return reviews.map((review) => ({
    ...review,
    goals: goals.filter((goal) => String(goal.treatment_plan_review_id ?? "") === review.id),
  }));
}

export async function generateTreatmentPlanReview(planId: string) {
  const plans = await tenantSelect<DataRow>("treatment_plans", { id: "eq." + planId, limit: "1" });
  const plan = plans[0];
  if (!plan) throw new Error("Treatment plan not found.");
  if (!["active", "signed"].includes(String(plan.status ?? ""))) {
    throw new Error("Only an active or signed treatment plan can generate a 90-day review draft.");
  }

  const period = buildReviewPeriod(plan.effective_date ? String(plan.effective_date) : null);
  const existing = await tenantSelect<DataRow>("treatment_plan_reviews", {
    treatment_plan_id: "eq." + planId,
    review_period_end: "eq." + period.end,
    status: "in.(draft,ready_for_review)",
    limit: "1",
  });
  if (existing[0]) return existing[0];

  const clientId = String(plan.client_id ?? "");
  const [goals, notes, outcomeScores] = await Promise.all([
    tenantSelect<DataRow>("treatment_plan_goals", {
      treatment_plan_id: "eq." + planId,
      order: "created_at.asc",
    }),
    tenantSelect<DataRow>("clinical_notes", {
      client_id: "eq." + clientId,
      note_status: "in.(signed,locked)",
      and: "(service_date.gte." + period.start + ",service_date.lte." + period.end + ")",
      order: "service_date.asc,created_at.asc",
    }),
    tenantSelect<DataRow>("patient_outcome_scores", {
      client_id: "eq." + clientId,
      and: "(administered_date.gte." + period.start + ",administered_date.lte." + period.end + ")",
      order: "administered_date.asc,created_at.asc",
    }),
  ]);

  const noteIds = notes.map((row) => row.id);
  const structured = noteIds.length
    ? await tenantSelect<DataRow>("clinical_note_structured_data", { clinical_note_id: inFilter(noteIds) })
    : [];
  const outcomeTrends = buildOutcomeTrends(outcomeScores);

  const review = await tenantInsert<DataRow>("treatment_plan_reviews", {
    treatment_plan_id: plan.id,
    client_id: clientId,
    provider_id: plan.provider_id || null,
    review_period_start: period.start,
    review_period_end: period.end,
    status: "draft",
    generated_summary: buildReviewEvidenceSummary({
      periodStart: period.start,
      periodEnd: period.end,
      signedSessionCount: notes.length,
      structuredSessionCount: structured.length,
      outcomeTrends,
    }),
    outcome_snapshot: outcomeTrends,
    source_context: {
      signed_note_ids: noteIds,
      signed_session_count: notes.length,
      structured_session_count: structured.length,
      outcome_score_ids: outcomeScores.map((row) => row.id),
    },
  });

  await Promise.all(goals.map((goal) => {
    const sessionCount = goalReferenceCount(goal, notes);
    return tenantInsert<DataRow>("treatment_plan_review_goals", {
      treatment_plan_review_id: review.id,
      treatment_plan_goal_id: goal.id,
      goal_text_snapshot: String(goal.goal_text ?? ""),
      objective_text_snapshot: goal.objective_text || null,
      documented_session_count: sessionCount,
      progress_summary: buildGoalProgressSummary(goal, sessionCount),
      clinician_decision: "pending",
    });
  }));

  return review;
}

export async function saveTreatmentPlanReview(
  reviewId: string,
  clinicianSummary: string,
  goalEdits: Array<{ id: string; decision: string; comments: string }>,
) {
  const reviews = await tenantSelect<DataRow>("treatment_plan_reviews", { id: "eq." + reviewId, limit: "1" });
  const review = reviews[0];
  if (!review) throw new Error("Treatment plan review not found.");
  if (String(review.status ?? "") === "signed") throw new Error("Signed treatment plan reviews cannot be edited.");

  const allowed = new Set(["pending", "continue", "met", "revise", "discontinue"]);
  for (const edit of goalEdits) {
    if (!allowed.has(edit.decision)) throw new Error("Invalid goal review decision.");
  }

  await Promise.all(goalEdits.map((edit) =>
    tenantUpdate<DataRow>("treatment_plan_review_goals", edit.id, {
      clinician_decision: edit.decision,
      clinician_comments: edit.comments.trim() || null,
    })
  ));

  const ready = goalEdits.every((edit) => edit.decision !== "pending");
  return tenantUpdate<DataRow>("treatment_plan_reviews", reviewId, {
    clinician_summary: clinicianSummary.trim() || null,
    status: ready && clinicianSummary.trim() ? "ready_for_review" : "draft",
  });
}

export function signTreatmentPlanReview(reviewId: string) {
  return tenantRpc<DataRow>("sign_treatment_plan_review", { p_review_id: reviewId });
}
