import assert from "node:assert/strict";
import test from "node:test";
import { readNoteSection, updateNoteSection, noteDraftFingerprint } from "../src/domains/clinical/note-section-editing.ts";

test("editing a SOAP section preserves legacy narrative and adjacent sections", () => {
  const original = "Original narrative.\n\nSubjective:\nPatient report.\n\nObjective:\nObserved findings.\n\nPlan:\nFollow up.";
  const edited = updateNoteSection(original, "Subjective", "Updated report.");
  assert.equal(readNoteSection(edited, "Subjective"), "Updated report.");
  assert.ok(edited.startsWith("Original narrative."));
  assert.equal(readNoteSection(edited, "Objective"), "Observed findings.");
  assert.equal(readNoteSection(edited, "Plan"), "Follow up.");
});

test("new sections remain editable after saving and reopening note text", () => {
  let note = updateNoteSection("Legacy note.", "Assessment", "Clinical impression.");
  note = updateNoteSection(note, "Mental Status Examination", "Appearance: Clinician observation.");
  const reopened = JSON.parse(JSON.stringify({ note_text: note }));
  assert.equal(readNoteSection(reopened.note_text, "Assessment"), "Clinical impression.");
  assert.equal(readNoteSection(reopened.note_text, "Mental Status Examination"), "Appearance: Clinician observation.");
  note = updateNoteSection(note, "Assessment", "");
  assert.equal(readNoteSection(note, "Assessment"), "");
  assert.ok(note.includes("Appearance: Clinician observation."));
  assert.ok(note.includes("Legacy note."));
});

test("editing SOAP does not swallow template headings or patient source attribution", () => {
  const note = "Subjective:\nPatient statement.\n\nInterventions:\nSupportive therapy.\n\nPATIENT-REPORTED · PRE-VISIT CHECK-IN\nSource content.";
  const updated = updateNoteSection(note, "Subjective", "Revised statement.");
  assert.ok(updated.includes("Interventions:\nSupportive therapy."));
  assert.ok(updated.includes("PATIENT-REPORTED · PRE-VISIT CHECK-IN\nSource content."));
});

test("unsaved detection includes goal, note type, structured findings and provenance", () => {
  const saved = { noteText: "Note", noteType: "psychotherapy", goalAddressed: "Goal", structuredSelections: { anxiety: "mild" }, carryForwardContext: {} };
  const fingerprint = noteDraftFingerprint(saved);
  assert.equal(noteDraftFingerprint(JSON.parse(JSON.stringify(saved))), fingerprint);
  for (const change of [{ noteType: "assessment" }, { goalAddressed: "New goal" }, { structuredSelections: { anxiety: "severe" } }, { carryForwardContext: { source_note_id: "prior" } }]) {
    assert.notEqual(noteDraftFingerprint({ ...saved, ...change }), fingerprint);
  }
  assert.equal(noteDraftFingerprint({ ...saved, structuredSelections: { b: 2, a: 1 } }), noteDraftFingerprint({ ...saved, structuredSelections: { a: 1, b: 2 } }));
});

test("multiline MSE field labels remain part of the MSE section", () => {
  const body = "Appearance:\nObserved presentation.\nSpeech:\nObserved speech.";
  const edited = updateNoteSection("Plan:\nFollow up.", "Mental Status Examination", body);
  assert.equal(readNoteSection(edited, "Mental Status Examination"), body);
  assert.equal(readNoteSection(edited, "Plan"), "Follow up.");
});

test("editing or clearing SOAP preserves clinician-confirmed quick inserts", () => {
  const mse = "Mental Status Examination (clinician-confirmed):\nAppearance / behavior: [observed]\nOrientation: [assessed]";
  const risk = "Risk Assessment (clinician-confirmed):\nSuicidal ideation: [assess and document]";
  const original = `Subjective:\nPatient report.\n\n${mse}\n\n${risk}\n\nPlan:\nFollow up.`;
  for (const body of ["Updated report.", ""]) {
    const updated = updateNoteSection(original, "Subjective", body);
    assert.ok(updated.includes(mse));
    assert.ok(updated.includes(risk));
    assert.equal(readNoteSection(updated, "Plan"), "Follow up.");
  }
});

test("inline adjacent headings remain separate and editable", () => {
  const original = "Subjective:\nPatient report.\n\nObjective: Observed findings.\n\nAssessment: Clinical impression.";
  const updated = updateNoteSection(original, "Subjective", "Updated report.");
  assert.ok(updated.includes("Objective: Observed findings."));
  assert.equal(readNoteSection(updated, "Objective"), "Observed findings.");
  assert.equal(readNoteSection(updated, "Assessment"), "Clinical impression.");
});
