import test from "node:test";
import assert from "node:assert/strict";

import { phase2PatientChartScenarios } from "../src/domains/demo/phase2-scenarios.ts";

test("Phase 2 demo covers all patient chart capabilities", () => {
  const codes = phase2PatientChartScenarios.map((scenario) => scenario.code);
  assert.deepEqual(codes, [
    "complete_demographics",
    "multiple_insurance",
    "eligibility_history",
    "authorization_utilization",
    "treatment_plan_goals",
    "documents",
    "checkin",
    "journal",
  ]);
  assert.equal(new Set(phase2PatientChartScenarios.map((scenario) => scenario.patientId)).size, 1);
  assert.equal(phase2PatientChartScenarios.every((scenario) => scenario.synthetic === true), true);
});
