import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {noteTypeForService,noteTemplateLabelForService} from "../src/domains/encounters/service-note-template";
const schedule=readFileSync(new URL("../src/domains/scheduling/SchedulePage.tsx",import.meta.url),"utf8");
const encounter=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
const style=readFileSync(new URL("../src/domains/scheduling/schedule-appointment-drawer.css",import.meta.url),"utf8");
test("service dropdown selects the same canonical note template used by the encounter",()=>{
  const cases:[string,string][]=[["Individual Therapy","psychotherapy"],["Initial Assessment","assessment"],["Psychiatric Evaluation","assessment"],["Crisis Psychotherapy","crisis"],["Case Management","case_management"],["Medication Management","medication_management"]];
  for(const [name,type] of cases)assert.equal(noteTypeForService(name),type);
  assert.equal(noteTemplateLabelForService("Initial Assessment"),"Clinical Assessment");
  assert.match(encounter,/import \{ noteTypeForService \} from "\.\/service-note-template"/);
  assert.match(schedule,/noteTemplateLabelForService\(form.serviceType\)/);
});
test("add appointment drawer is grouped, responsive, has no visible CPT picker and preserves hidden code mapping",()=>{
  for(const title of ["Patient & provider","Date & time","Visit details","Starting note template"])assert.ok(schedule.includes(title),title);
  assert.match(schedule,/className="schedule-appointment-form"/);
  assert.match(schedule,/setForm\(\{ \.\.\.form, serviceType: e.target.value, cptCode:/);
  assert.doesNotMatch(schedule,/<label>CPT/);
  assert.match(style,/@media\(max-width:540px\)/);
});
test("appointment save errors remain visible inside the drawer and clinician selection is scoped",()=>{
  assert.match(schedule,/setFormError\(err instanceof Error/);
  assert.match(schedule,/\{formError && <div className="thera-state error" role="alert">/);
  assert.match(schedule,/disabled=\{clinicianView\}/);
  assert.match(schedule,/!dirty \|\| window.confirm/);
});
