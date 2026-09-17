import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const drawerUrl = new URL("../src/domains/scheduling/PatientReviewDrawer.tsx", import.meta.url);

test("provider Patient Review reads submitted pre-visit questions before legacy check-in fields", () => {
  const source = readFileSync(drawerUrl, "utf8");

  assert.match(source, /responses/);
  assert.match(source, /pre_visit/);
  assert.match(source, /visit_questions/);

  for (const field of [
    "focus_today",
    "feeling_since_last_visit",
    "important_changes",
    "safety_concerns",
    "treatment_goal",
    "anything_else",
  ]) {
    assert.match(source, new RegExp(field));
  }

  assert.match(source, /preVisitQuestions/);
  assert.match(source, /preVisitQuestions[^\n]*focus_today|focus_today[^\n]*preVisitQuestions/);
});
