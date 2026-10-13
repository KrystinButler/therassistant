import assert from "node:assert/strict";
import test from "node:test";

import * as screeners from "../../artifacts/therassistant-inventory/src/domains/portal/portal-screeners.ts";

test("PHQ-9 and GAD-7 totals require complete response sets", () => {
  assert.equal(screeners.screenerTotal(Array(9).fill(1), 9), 9);
  assert.equal(screeners.screenerTotal(Array(7).fill(2), 7), 14);
  assert.equal(screeners.screenerTotal([1, 2, null, ...Array(6).fill(0)], 9), null);
});

test("C-SSRS completeness follows conditional response branches", () => {
  const base = {
    phq9: Array(9).fill(0),
    gad7: Array(7).fill(0),
    cssrs: [false, false, null, null, null, false, null],
  };
  assert.equal(screeners.screenersComplete(base), true);

  assert.equal(screeners.screenersComplete({
    ...base,
    cssrs: [false, true, null, false, false, false, null],
  }), false);

  assert.equal(screeners.screenersComplete({
    ...base,
    cssrs: [false, true, true, false, false, false, null],
  }), true);
});

test("declined screeners are complete without manufacturing scores", () => {
  const answers = { ...screeners.emptyScreeners(), declined: true };
  assert.equal(screeners.screenersComplete(answers), true);
  assert.equal(screeners.screenerTotal(answers.phq9, 9), null);
  assert.equal(screeners.screenerTotal(answers.gad7, 7), null);
});

test("summarizeScreeners exposes submitted questionnaire state without a clinician risk classification", () => {
  const summarizeScreeners = (screeners as typeof screeners & {
    summarizeScreeners?: (value: screeners.ScreenerAnswers) => Record<string, unknown>;
  }).summarizeScreeners;

  assert.equal(typeof summarizeScreeners, "function", "summarizeScreeners must be implemented");
  const answers: screeners.ScreenerAnswers = {
    phq9: Array(9).fill(1),
    gad7: Array(7).fill(2),
    cssrs: [false, true, true, false, false, false, null],
  };
  const summary = summarizeScreeners!(answers);

  assert.equal(summary.phq9Total, 9);
  assert.equal(summary.gad7Total, 14);
  assert.equal(summary.cssrsSubmitted, true);
  assert.deepEqual(summary.cssrsPositiveItems, [1, 2]);
  assert.deepEqual(summary.phq9Responses, answers.phq9);
  assert.deepEqual(summary.gad7Responses, answers.gad7);
  assert.deepEqual(summary.cssrsResponses, answers.cssrs);
  assert.equal("riskLevel" in summary, false);
  assert.equal("diagnosis" in summary, false);
});
