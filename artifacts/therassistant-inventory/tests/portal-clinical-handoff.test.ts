import test from "node:test";
import assert from "node:assert/strict";
import { getPreVisitSummary, portalSectionMatchesSaved, getJournalDisplayState } from "../src/domains/portal/portal-progress.ts";
import { buildPreVisitResponses, buildJournalEntryValues } from "../src/domains/portal/workflow";
import { buildPatientReviewCheckIn } from "../src/domains/scheduling/patient-review-model";
import { buildPreVisitNoteInsert, latestSharedJournalEntry, buildJournalNoteInsert, readSubmittedVisitQuestion } from "../src/domains/encounters/clinical-source-context";

test("saved check-in drafts remain distinct from submitted provider source content", () => {
  const responses = buildPreVisitResponses({}, { visit_questions: { focus_today: "Synthetic focus" } });
  const checkin = { id: "checkin", responses };
  assert.equal(getPreVisitSummary(checkin).label, "Saved draft · not submitted");
  assert.equal(getPreVisitSummary(checkin).action, "Continue Check-In");
  assert.equal(buildPreVisitNoteInsert(buildPatientReviewCheckIn(checkin)), "");
});

test("submitted patient answers map to the attributed clinical-note import", () => {
  const responses = buildPreVisitResponses({}, { demographics_confirmed: true, insurance_confirmed: true,
    visit_questions: { focus_today: "Synthetic focus", feeling_since_last_visit: "Synthetic mood", important_changes: "Synthetic change", safety_concerns: "No concerns", treatment_goal: "Synthetic goal", anything_else: "Synthetic context", somatic_distress_score: 4 },
    consents: { information_accurate: true, privacy_acknowledged: true, care_acknowledged: true }, submitted: true });
  const checkin = { id: "checkin", responses };
  const state = getPreVisitSummary(checkin);
  assert.equal(state.submitted, true);
  assert.equal(state.completeSteps, 5);
  const note = buildPreVisitNoteInsert(buildPatientReviewCheckIn(checkin));
  for (const value of ["Synthetic focus", "Synthetic mood", "Synthetic change", "No concerns", "Synthetic goal", "Synthetic context"]) assert.ok(note.includes(value));
  assert.ok(note.includes("PATIENT-REPORTED"));
  assert.ok(!note.includes("C-SSRS"));
});

test("editing a saved answer invalidates its completed state", () => {
  const saved = { focus_today: "Saved", treatment_goal: "Goal" };
  assert.equal(portalSectionMatchesSaved(saved, { treatment_goal: "Goal", focus_today: "Saved" }, "2026-10-12"), true);
  assert.equal(portalSectionMatchesSaved({ ...saved, focus_today: "Unsaved" }, saved, "2026-10-12"), false);
  assert.equal(portalSectionMatchesSaved(saved, saved, ""), false);
});

test("private and draft journals cannot become shared clinical-note source content", () => {
  const draft = { id: "draft", ...buildJournalEntryValues({ entryText: "Draft content", visibility: "shared_with_provider", entryStatus: "draft" }) };
  const privateEntry = { id: "private", ...buildJournalEntryValues({ entryText: "Private content", visibility: "private" }) };
  const shared = { id: "shared", ...buildJournalEntryValues({ entryText: "Synthetic shared content", visibility: "shared_with_provider" }) };
  assert.equal(getJournalDisplayState(draft).label, "Draft · not shared");
  assert.equal(getJournalDisplayState(privateEntry).label, "Saved privately");
  assert.equal(getJournalDisplayState(shared).label, "Shared with provider");
  assert.equal(latestSharedJournalEntry([draft, privateEntry, shared])?.id, "shared");
  assert.equal(buildJournalNoteInsert(draft), "");
  assert.equal(buildJournalNoteInsert(privateEntry), "");
  assert.ok(buildJournalNoteInsert(shared).includes("PATIENT-AUTHORED CONTENT"));
});

test("draft treatment goals never enter the clinical workspace or its insert actions", () => {
  const draft = { responses: { pre_visit: { visit_questions: { treatment_goal: "Unsubmitted goal" } } } };
  assert.equal(readSubmittedVisitQuestion(draft, ["goal_to_work_on", "treatment_goal"]), "");
  const submitted = { responses: { pre_visit: { submitted_at: "2026-10-12T10:00:00Z", visit_questions: { treatment_goal: "Submitted goal" } } } };
  assert.equal(readSubmittedVisitQuestion(submitted, ["goal_to_work_on", "treatment_goal"]), "Submitted goal");
});
