import test from "node:test";import assert from "node:assert/strict";import { readFileSync } from "node:fs";
const encounter=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
const fast=readFileSync(new URL("../src/domains/clinical/FastChartingPanel.tsx",import.meta.url),"utf8");
const timeline=readFileSync(new URL("../src/domains/clinical/SessionTimelinePanel.tsx",import.meta.url),"utf8");
test("session timeline is next to encounter timing and above the note editor",()=>{
  const controls=encounter.indexOf('className="encounter-note-controls"');
  const panel=encounter.indexOf("<SessionTimelinePanel ");
  const editor=encounter.indexOf('className="encounter-editor-surface"');
  assert.ok(controls>=0&&controls<panel&&panel<editor);
  assert.doesNotMatch(fast,/Session Timeline|timelineTime|addTimelineEvent/);
});
test("relocation keeps events, KAP shortcuts, manual insertion, and read-only signed behavior",()=>{
  for(const value of ["addTimelineEvent","removeTimelineEvent","formatTimelineForNote","Insert Timeline into Note","kap_medicine_session","!props.signed","onSelectionsChange"])assert.ok(timeline.includes(value),value);
  assert.match(timeline,/<details className="encounter-session-timeline"/);
});
