import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTreatmentGoalValues,
  buildTreatmentPlanValues,
  treatmentPlanAlert,
  validateGoalOwnership,
} from "../src/domains/treatment-plans/workflow.ts";

test("treatment plan requires responsible provider and plan text", () => {
  assert.throws(
    () => buildTreatmentPlanValues({ providerId: "", status: "draft", planText: "Plan" }),
    /provider/i,
  );
  assert.throws(
    () => buildTreatmentPlanValues({ providerId: "provider-1", status: "draft", planText: "" }),
    /plan/i,
  );
});

test("treatment plan alert identifies review due and overdue", () => {
  assert.equal(
    treatmentPlanAlert({ status: "active", reviewDueDate: "2026-09-20" }, new Date("2026-09-13T12:00:00Z")).code,
    "review_due",
  );
  assert.equal(
    treatmentPlanAlert({ status: "active", reviewDueDate: "2026-09-01" }, new Date("2026-09-13T12:00:00Z")).code,
    "overdue",
  );
});

test("goal values require measurable goal text", () => {
  assert.throws(() => buildTreatmentGoalValues({ goalText: "", status: "active" }), /goal/i);
  const result = buildTreatmentGoalValues({
    goalText: "Use two coping skills during periods of anxiety",
    objectiveText: "Patient will report use weekly",
    status: "active",
  });
  assert.equal(result.goal_text, "Use two coping skills during periods of anxiety");
});

test("goal ownership must match treatment plan", () => {
  assert.doesNotThrow(() => validateGoalOwnership("plan-1", { treatment_plan_id: "plan-1" }));
  assert.throws(() => validateGoalOwnership("plan-1", { treatment_plan_id: "plan-2" }), /treatment plan/i);
});
