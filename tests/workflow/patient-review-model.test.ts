import assert from "node:assert/strict";
import test from "node:test";

import { buildPatientReviewCheckIn } from "../../artifacts/therassistant-inventory/src/domains/scheduling/patient-review-model.ts";

const submittedCheckIn = {
  id: "checkin-1",
  responses: {
    pre_visit: {
      submitted_at: "2026-10-12T18:00:00Z",
      visit_questions: {
        focus_today: "Sleep and anxiety",
        screeners: {
          phq9: Array(9).fill(1),
          gad7: Array(7).fill(2),
          cssrs: [false, true, true, false, false, false, null],
        },
      },
    },
  },
};

test("submitted portal screeners are available in the clinician patient-review model", () => {
  const review = buildPatientReviewCheckIn(submittedCheckIn) as ReturnType<typeof buildPatientReviewCheckIn> & {
    screeners?: Record<string, unknown>;
  };

  assert.ok(review.screeners, "submitted screeners must be carried into clinician review");
  assert.equal(review.screeners?.phq9Total, 9);
  assert.equal(review.screeners?.gad7Total, 14);
  assert.equal(review.screeners?.cssrsSubmitted, true);
  assert.deepEqual(review.screeners?.cssrsPositiveItems, [1, 2]);
});

test("unsubmitted portal drafts are excluded from clinician review", () => {
  const draft = structuredClone(submittedCheckIn);
  delete (draft.responses.pre_visit as { submitted_at?: string }).submitted_at;

  const review = buildPatientReviewCheckIn(draft) as ReturnType<typeof buildPatientReviewCheckIn> & {
    screeners?: Record<string, unknown> | null;
  };

  assert.equal(review.hasSubmittedPreVisit, false);
  assert.equal(review.screeners ?? null, null);
  assert.equal(review.focus, "");
});

test("declined screeners stay visibly deferred instead of producing zero scores", () => {
  const declined = structuredClone(submittedCheckIn);
  declined.responses.pre_visit.visit_questions.screeners = {
    phq9: Array(9).fill(null) as unknown as number[],
    gad7: Array(7).fill(null) as unknown as number[],
    cssrs: Array(7).fill(null) as unknown as boolean[],
    declined: true,
  } as typeof declined.responses.pre_visit.visit_questions.screeners & { declined: boolean };

  const review = buildPatientReviewCheckIn(declined) as ReturnType<typeof buildPatientReviewCheckIn> & {
    screeners?: Record<string, unknown>;
  };

  assert.equal(review.screeners?.declined, true);
  assert.equal(review.screeners?.phq9Total, null);
  assert.equal(review.screeners?.gad7Total, null);
});
