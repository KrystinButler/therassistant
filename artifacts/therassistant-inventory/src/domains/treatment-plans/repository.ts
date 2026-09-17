import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import {
  buildTreatmentGoalValues,
  buildTreatmentPlanValues,
  treatmentPlanAlert,
  type TreatmentGoalDraft,
  type TreatmentPlanDraft,
} from "./workflow";

type DataRow = Row & { id: string };

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
    tenantSelect<DataRow>("treatment_plans", { client_id: `eq.${patientId}`, order: "effective_date.desc.nullslast,created_at.desc" }),
    tenantSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
  ]);
  const planIds = new Set(plans.map((row) => row.id));
  return plans.map((plan) => ({
    ...plan,
    goals: goals.filter((goal) => planIds.has(String(goal.treatment_plan_id)) && goal.treatment_plan_id === plan.id),
    alert: treatmentPlanAlert({ status: String(plan.status ?? "draft"), reviewDueDate: plan.review_due_date ? String(plan.review_due_date) : null }),
  }));
}
