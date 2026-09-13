import type { Row } from "../../lib/supabase-demo-client";

export type TreatmentPlanDraft = {
  providerId: string;
  status: "draft" | "active" | "under_review" | "expired" | "discontinued" | "superseded" | "signed";
  effectiveDate?: string;
  reviewDueDate?: string;
  problemStatement?: string;
  planText: string;
  interventions?: string;
};

export type TreatmentGoalDraft = {
  goalText: string;
  objectiveText?: string;
  status?: string;
};

export function buildTreatmentPlanValues(input: TreatmentPlanDraft): Row {
  if (!input.providerId.trim()) throw new Error("Responsible provider is required.");
  if (!input.planText.trim()) throw new Error("Treatment plan text is required.");
  return {
    provider_id: input.providerId,
    status: input.status,
    effective_date: input.effectiveDate || null,
    review_due_date: input.reviewDueDate || null,
    problem_statement: input.problemStatement?.trim() || null,
    plan_text: input.planText.trim(),
    interventions: input.interventions?.trim() || null,
    signed_at: ["active", "signed"].includes(input.status) ? new Date().toISOString() : null,
  };
}

export function buildTreatmentGoalValues(input: TreatmentGoalDraft): Row {
  const goal = input.goalText.trim();
  if (!goal) throw new Error("Treatment goal is required.");
  return {
    goal_text: goal,
    objective_text: input.objectiveText?.trim() || null,
    status: input.status || "active",
  };
}

export function validateGoalOwnership(planId: string, goal: Row) {
  if (String(goal.treatment_plan_id ?? "") !== planId) {
    throw new Error("Goal does not belong to this treatment plan.");
  }
}

export function treatmentPlanAlert(
  input: { status: string; reviewDueDate?: string | null },
  today = new Date(),
) {
  if (["discontinued", "superseded", "expired"].includes(input.status)) {
    return { code: input.status, blocking: true, message: `Treatment plan is ${input.status.replaceAll("_", " ")}.` } as const;
  }
  if (input.status === "draft" || input.status === "under_review") {
    return { code: input.status, blocking: true, message: `Treatment plan is ${input.status.replaceAll("_", " ")}.` } as const;
  }
  if (input.reviewDueDate) {
    const due = new Date(`${input.reviewDueDate}T23:59:59`);
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
    if (diffDays < 0) return { code: "overdue", blocking: false, message: "Treatment plan review is overdue." } as const;
    if (diffDays <= 14) return { code: "review_due", blocking: false, message: `Treatment plan review is due in ${diffDays} days.` } as const;
  }
  return { code: "active", blocking: false, message: "Treatment plan is current." } as const;
}
