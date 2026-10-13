import assert from "node:assert/strict";
import test from "node:test";

import { buildPreVisitNoteInsert, withClinicalSourceImport } from "../../artifacts/therassistant-inventory/src/domains/encounters/clinical-source-context.ts";
import { buildPatientReviewCheckIn } from "../../artifacts/therassistant-inventory/src/domains/scheduling/patient-review-model.ts";

const checkIn = {
  id: "checkin-42",
  created_at: "2026-10-12T17:55:00Z",
  responses: {
    pre_visit: {
      submitted_at: "2026-10-12T18:00:00Z",
      visit_questions: {
        focus_today: "Sleep and anxiety",
        safety_concerns: "I want to discuss intrusive thoughts.",
        screeners: {
          phq9: Array(9).fill(1),
          gad7: Array(7).fill(2),
          cssrs: [false, true, true, false, false, false, null],
        },
      },
    },
  },
};

test("pre-visit note insert labels portal answers and screening scores as patient-reported", () => {
  const review = buildPatientReviewCheckIn(checkIn);
  const block = buildPreVisitNoteInsert(review);

  assert.match(block, /PATIENT-REPORTED PRE-VISIT INFORMATION \(Patient Portal\)/);
  assert.match(block, /PHQ-9.*9/i);
  assert.match(block, /GAD-7.*14/i);
  assert.match(block, /C-SSRS.*submitted/i);
  assert.doesNotMatch(block, /diagnosis:/i);
  assert.doesNotMatch(block, /risk level:/i);
});

test("source import provenance is idempotent for the same patient-authored check-in", () => {
  const provenance = {
    source_type: "pre_visit_checkin" as const,
    source_id: "checkin-42",
    source_date: "2026-10-12",
    patient_authored: true as const,
  };

  const once = withClinicalSourceImport({}, provenance);
  const twice = withClinicalSourceImport(once, provenance);

  assert.deepEqual(twice.source_imports, [provenance]);
});
