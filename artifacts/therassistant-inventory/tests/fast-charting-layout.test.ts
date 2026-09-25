import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/domains/clinical/FastChartingPanel.tsx",import.meta.url),"utf8");
test("removed Findings & Interventions card does not reappear in encounter",()=>{
  assert.doesNotMatch(source,/fast-chart-findings-heading|fast-chart-findings-grid|Record only what you assessed/);
  assert.doesNotMatch(source,/setSeverity\(|toggleIntervention\(/);
  assert.match(source,/SmartPhrases/);
  assert.match(source,/Carry Forward Clinical Context/);
});
test("specialty modules and patient-specific clinical tags remain available",()=>{
  assert.match(source,/CLINICAL_TAG_OPTIONS\.map/);
  assert.match(source,/ForensicSpecialtyPanel/);
  assert.match(source,/PsychedelicSpecialtyPanel/);
  assert.match(source,/disabled=\{props.signed\}/);
});
