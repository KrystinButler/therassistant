import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTreatmentGoalValues, buildTreatmentPlanValues } from "../src/domains/treatment-plans/workflow";

const encounter = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../src/domains/treatment-plans/EncounterTreatmentPlanComposer.tsx", import.meta.url), "utf8");

test("encounter treatment-plan tab opens a real creation form without leaving or overwriting clinical note", () => {
  assert.match(encounter, /Create treatment plan for this patient/);
  assert.match(encounter, /<EncounterTreatmentPlanComposer/);
  assert.match(encounter, /getTreatmentPlanWorkspace/);
  assert.match(encounter, /setData\(\(current\) => current \?/);
  assert.match(encounter, /Create a treatment plan or goal/);
});
test("in-encounter plan composer reuses canonical tenant-scoped plan and goal writes", () => {
  assert.match(composer, /createTreatmentPlan\(patientId, draft\)/);
  assert.match(composer, /addTreatmentGoal\(planId/);
  assert.match(composer, /setCreatedPlanId\(planId\)/);
  assert.match(composer, /status: "draft"/);
  assert.match(composer, /existingPlanId/);
  assert.deepEqual(buildTreatmentPlanValues({ providerId: "provider1", status: "draft", planText: "CBT" }), {
    provider_id: "provider1", status: "draft", effective_date: null, review_due_date: null,
    problem_statement: null, plan_text: "CBT", interventions: null, signed_at: null,
  });
  assert.equal(buildTreatmentGoalValues({ goalText: "Record two coping strategies" }).goal_text, "Record two coping strategies");
});
