import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPreVisitNoteInsert, buildClinicalSourceProvenance, appendClinicalSource, withClinicalSourceImport } from "../src/domains/encounters/clinical-source-context";

const page = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
test("encounter displays import control beside actual editor, preserving attribution and review",()=>{
  const button=page.indexOf("Import Answers into Note");
  const editor=page.indexOf('id="encounter-progress-note-editor"');
  assert.ok(button>0 && editor>button,"Import must be immediately above the editor");
  assert.match(page,/disabled=\{signed \|\| !preVisitInsert \|\| preVisitAlreadyImported\}/);
  assert.match(page,/buildClinicalSourceProvenance\("pre_visit_checkin", currentCheckin\)/);
  assert.match(page,/Preview patient answers/);
});
test("unscheduled encounters cannot accidentally import unrelated check-ins",()=>{
  assert.match(page,/const currentCheckin = encounter.appointment_id\s*\?/);
  assert.match(page,/String\(row.appointment_id \?\? ""\) === String\(encounter.appointment_id\)/);
});
test("only submitted patient-authored fields are importable, and repeated inserts are deduplicated",()=>{
  const review={hasSubmittedPreVisit:true,focus:"Feeling overwhelmed",mood:"Worse",changes:["Started new job"],safetyText:"No",treatmentGoal:"Improve sleep",additionalContext:"Help with routines",safetyConcern:false};
  const block=buildPreVisitNoteInsert(review);
  assert.match(block,/PATIENT-REPORTED PRE-VISIT/);
  assert.match(block,/Started new job/);
  assert.match(block,/Safety response: No/);
  assert.equal(appendClinicalSource(block,block),block);
  const provenance=buildClinicalSourceProvenance("pre_visit_checkin",{id:"checkin-1",submitted_at:"2026-09-24T10:00:00Z"});
  const context=withClinicalSourceImport(withClinicalSourceImport({},provenance),provenance);
  assert.equal((context.source_imports as unknown[]).length,1);
  assert.equal(buildPreVisitNoteInsert({...review,hasSubmittedPreVisit:false}),"");
});
