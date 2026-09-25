import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fast=readFileSync(new URL("../src/domains/clinical/FastChartingPanel.tsx",import.meta.url),"utf8");
const encounter=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/domains/clinical/fast-charting-panel.css",import.meta.url),"utf8");
test("ordinary progress notes do not display a redundant second note-template guidance panel",()=>{
  assert.doesNotMatch(fast,/Note Template & Guidance|Template Guidance|Documentation Template/);
  assert.match(fast,/Optional\. Your Note Type above controls the main note layout/);
  assert.match(fast,/aria-expanded=\{advancedOpen\}/);
  assert.match(fast,/advancedOpen && <div id="fast-chart-advanced-content"/);
  assert.match(encounter,/FastChartingPanel signed=\{signed\} noteType=\{noteType\}/);
});
test("optional specialty modules and clinical tags remain available and signed notes stay read-only",()=>{
  assert.match(fast,/DOCUMENTATION_TEMPLATES\.filter/);
  assert.match(fast,/ForensicSpecialtyPanel/);
  assert.match(fast,/PsychedelicSpecialtyPanel/);
  assert.match(fast,/CLINICAL_TAG_OPTIONS\.map/);
  assert.match(fast,/disabled=\{props.signed\}/);
  assert.match(fast,/if \(hasSpecialty \|\| props.selections.clinicalTags.length > 0\) setAdvancedOpen\(true\)/);
  assert.match(css,/@media\(max-width:650px\)/);
});
