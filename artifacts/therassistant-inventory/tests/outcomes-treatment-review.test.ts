import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOutcomeTrends,
  validateOutcomeScore,
} from "../src/domains/outcomes/workflow";
import {
  buildReviewEvidenceSummary,
  buildReviewPeriod,
  goalReferenceCount,
  nextReviewDueDate,
} from "../src/domains/treatment-plans/review-workflow";

test("PHQ-9 and GAD-7 score bounds are enforced", () => {
  assert.doesNotThrow(() => validateOutcomeScore({
    instrumentCode: "phq9",
    administeredDate: "2026-09-22",
    totalScore: 27,
  }));
  assert.throws(() => validateOutcomeScore({
    instrumentCode: "gad7",
    administeredDate: "2026-09-22",
    totalScore: 22,
  }), /between 0 and 21/);
});

test("outcome trend reports raw longitudinal score change without clinical interpretation", () => {
  const trends = buildOutcomeTrends([
    { instrument_code: "gad7", administered_date: "2026-07-01", total_score: 14 },
    { instrument_code: "gad7", administered_date: "2026-09-01", total_score: 8 },
  ]);
  assert.equal(trends.length, 1);
  assert.equal(trends[0].earliestScore, 14);
  assert.equal(trends[0].latestScore, 8);
  assert.equal(trends[0].change, -6);
  assert.equal(trends[0].direction, "decreased");
});

test("review period covers 90 calendar days inclusive", () => {
  const period = buildReviewPeriod(null, new Date("2026-09-22T12:00:00Z"));
  assert.equal(period.end, "2026-09-22");
  assert.equal(period.start, "2026-06-25");
  assert.equal(nextReviewDueDate(period.end), "2026-12-21");
});

test("goal evidence counts only explicit goal-addressed references", () => {
  const goal = { goal_text: "Use grounding skills during panic symptoms", objective_text: "Practice grounding" };
  const count = goalReferenceCount(goal, [
    { goal_addressed: "Use grounding skills during panic symptoms" },
    { goal_addressed: "Sleep hygiene" },
    { goal_addressed: "" },
  ]);
  assert.equal(count, 1);
});

test("generated review summary explicitly requires clinician interpretation", () => {
  const summary = buildReviewEvidenceSummary({
    periodStart: "2026-06-25",
    periodEnd: "2026-09-22",
    signedSessionCount: 6,
    structuredSessionCount: 4,
    outcomeTrends: [],
  });
  assert.match(summary, /requires clinician interpretation, editing, and approval/);
  assert.doesNotMatch(summary, /recommend|should continue|goal met/i);
});
