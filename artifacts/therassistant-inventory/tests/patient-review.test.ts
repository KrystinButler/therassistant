import test from "node:test";
import assert from "node:assert/strict";

import { normalizePreVisitResponses } from "../src/domains/portal/check-in-contract.ts";

test("normalizes supported pre-visit response keys and ignores unknown values", () => {
  assert.deepEqual(
    normalizePreVisitResponses({
      focus_today: "Work stress",
      mood_since_last_visit: "More anxious",
      recent_changes: "New job",
      safety_concerns: "No",
      goal_focus: "Use breathing skills",
      provider_message: "Discuss boundaries",
      unrelated: "ignore me",
    }),
    {
      focusToday: "Work stress",
      moodSinceLastVisit: "More anxious",
      recentChanges: "New job",
      safetyConcerns: "No",
      goalFocus: "Use breathing skills",
      providerMessage: "Discuss boundaries",
    },
  );
});
