import test from "node:test";
import assert from "node:assert/strict";

import {
  appendClinicalSource,
  buildClinicalSourceProvenance,
  buildJournalNoteInsert,
  buildPreVisitNoteInsert,
  latestSharedJournalEntry,
  withClinicalSourceImport,
} from "../src/domains/encounters/clinical-source-context.ts";

test("only submitted provider-shared journal entries are eligible for clinical import", () => {
  const latest = latestSharedJournalEntry([
    {
      id: "private-new",
      entry_date: "2026-09-19",
      entry_text: "Private entry",
      visibility: "private",
      entry_status: "submitted",
    },
    {
      id: "shared-draft",
      entry_date: "2026-09-18",
      entry_text: "Shared draft",
      visibility: "shared_with_provider",
      entry_status: "draft",
    },
    {
      id: "shared-submitted",
      entry_date: "2026-09-17",
      entry_text: "Shared submitted entry",
      visibility: "shared_with_provider",
      entry_status: "submitted",
    },
  ]);

  assert.equal(latest?.id, "shared-submitted");
  assert.match(buildJournalNoteInsert(latest), /PATIENT JOURNAL IMPORT — PATIENT-AUTHORED CONTENT/);
  assert.match(buildJournalNoteInsert(latest), /Shared submitted entry/);
});

test("pre-visit insert is clearly patient-reported and only exists after submission", () => {
  const submitted = buildPreVisitNoteInsert({
    focus: "Prepare for a difficult meeting",
    mood: "More stable",
    changes: ["Sleeping better"],
    treatmentGoal: "Use coping skills",
    additionalContext: "Discuss side effects",
    safetyText: "No safety concerns",
    safetyConcern: false,
    hasSubmittedPreVisit: true,
  });

  assert.match(submitted, /PATIENT-REPORTED PRE-VISIT INFORMATION/);
  assert.match(submitted, /Prepare for a difficult meeting/);

  const draft = buildPreVisitNoteInsert({
    focus: "Draft answer",
    mood: "",
    changes: [],
    treatmentGoal: "",
    additionalContext: "",
    safetyText: "",
    safetyConcern: null,
    hasSubmittedPreVisit: false,
  });
  assert.equal(draft, "");
});

test("clinical source append does not duplicate the same patient-provided block", () => {
  const block = "PATIENT-REPORTED PRE-VISIT INFORMATION (Patient Portal)\nFocus for visit: Anxiety";
  const once = appendClinicalSource("Provider note", block);
  const twice = appendClinicalSource(once, block);

  assert.equal(twice, once);
  assert.match(once, /Provider note\n\nPATIENT-REPORTED/);
});

test("patient narrative provenance is recorded once per imported source", () => {
  const provenance = buildClinicalSourceProvenance("journal_entry", {
    id: "journal-1",
    entry_date: "2026-09-23",
  });
  assert.deepEqual(provenance, {
    source_type: "journal_entry",
    source_id: "journal-1",
    source_date: "2026-09-23",
    patient_authored: true,
  });

  const once = withClinicalSourceImport({}, provenance);
  const twice = withClinicalSourceImport(once, provenance);
  assert.equal(Array.isArray(twice.source_imports), true);
  assert.equal((twice.source_imports as unknown[]).length, 1);
});
