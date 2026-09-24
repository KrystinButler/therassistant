import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../src/domains/clinical/FastChartingPanel.tsx",import.meta.url),"utf8");
const style=readFileSync(new URL("../src/domains/clinical/fast-charting-panel.css",import.meta.url),"utf8");
test("clinical finding options have accessible pressed state, grouped severities and intervention controls",()=>{
  assert.match(source,/aria-pressed=\{active\}/);
  assert.match(source,/role="group" aria-label="Anxiety severity"/);
  assert.match(source,/role="group" aria-label="Depression severity"/);
  assert.match(source,/role="group" aria-label="Interventions provided"/);
  assert.match(source,/disabled=\{props.signed\}/);
});
test("responsive structured findings layout retains narrative insert and does not infer findings",()=>{
  assert.match(source,/fast-chart-findings-grid/);
  assert.match(source,/props.generatedNarrative/);
  assert.match(source,/onInsertNarrative/);
  assert.match(source,/Not assessed/);
  assert.match(style,/@media\(max-width:930px\)/);
  assert.match(style, /\[aria-pressed="true"\]/);
});
