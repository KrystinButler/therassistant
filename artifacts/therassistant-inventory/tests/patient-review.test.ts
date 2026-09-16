import test from "node:test";
import assert from "node:assert/strict";

import { normalizePreVisitResponses } from "../src/domains/portal/check-in-contract.ts";
import { buildPatientReviewContext } from "../src/domains/scheduling/patient-review.ts";

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

test("checked-in patient is Ready and patient focus wins the session-focus fallback chain", () => {
  const result = buildPatientReviewContext({
    checkin: {
      checked_in_at: "2026-09-15T15:00:00Z",
      responses: {
        focus_today: "Managing anxiety at work",
        safety_concerns: "No",
      },
    },
    journals: [],
    activeGoal: {
      id: "goal-1",
      goal_text: "Reduce anxiety",
      status: "in_progress",
    },
    priorNote: { plan_text: "Continue grounding skills" },
  });

  assert.equal(result.checkInStatus, "Ready");
  assert.equal(result.sessionFocus, "Managing anxiety at work");
  assert.equal(result.hasSafetyConcern, false);
});

test("shared journal is selected while private and draft journals are excluded", () => {
  const result = buildPatientReviewContext({
    checkin: null,
    journals: [
      {
        id: "draft-shared",
        entry_text: "draft",
        visibility: "shared_with_provider",
        entry_status: "draft",
        created_at: "2026-09-16T12:00:00Z",
      },
      {
        id: "private",
        entry_text: "private",
        visibility: "private",
        created_at: "2026-09-15T12:00:00Z",
      },
      {
        id: "shared",
        entry_text: "shared",
        visibility: "shared_with_provider",
        entry_status: "submitted",
        created_at: "2026-09-14T12:00:00Z",
      },
    ],
    activeGoal: null,
    priorNote: null,
  });

  assert.equal(result.latestSharedJournal?.id, "shared");
});

test("legacy shared journal flag remains supported for submitted rows", () => {
  const result = buildPatientReviewContext({
    checkin: null,
    journals: [
      {
        id: "shared",
        entry_text: "shared",
        share_with_provider: true,
        created_at: "2026-09-14T12:00:00Z",
      },
    ],
    activeGoal: null,
    priorNote: null,
  });

  assert.equal(result.latestSharedJournal?.id, "shared");
});

test("affirmative safety text is surfaced as a concern", () => {
  const result = buildPatientReviewContext({
    checkin: {
      responses: { safety_concerns: "Yes - thoughts of self-harm" },
    },
    journals: [],
    activeGoal: null,
    priorNote: null,
  });

  assert.equal(result.hasSafetyConcern, true);
});
