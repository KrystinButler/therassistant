import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePreSession } from "../src/domains/readiness/evaluate-pre-session.ts";

const payerReady = {
  policy: { status: "active" },
  eligibility: { eligibility_status: "active" },
  providerEnrollmentStatus: "approved",
};

test("missing treatment plan is visible but does not block first-visit care", () => {
  const result = evaluatePreSession({
    ...payerReady,
    treatmentPlan: null,
  });

  const planCheck = result.checks.find((check) => check.code === "treatment_plan_missing");
  assert.equal(result.ready, true);
  assert.equal(planCheck?.status, "warn");
  assert.equal(planCheck?.blocking, false);
});

test("current treatment plan passes clinical readiness", () => {
  const result = evaluatePreSession({
    ...payerReady,
    treatmentPlan: {
      status: "active",
      review_due_date: "2026-10-01",
    },
    serviceDate: "2026-09-20",
  });

  const planCheck = result.checks.find((check) => check.code === "treatment_plan_current");
  assert.equal(planCheck?.status, "pass");
  assert.equal(planCheck?.blocking, false);
});

test("overdue treatment plan review is a non-blocking warning", () => {
  const result = evaluatePreSession({
    ...payerReady,
    treatmentPlan: {
      status: "active",
      review_due_date: "2026-09-01",
    },
    serviceDate: "2026-09-20",
  });

  const planCheck = result.checks.find((check) => check.code === "treatment_plan_review_overdue");
  assert.equal(result.ready, true);
  assert.equal(planCheck?.status, "warn");
  assert.equal(planCheck?.blocking, false);
});
