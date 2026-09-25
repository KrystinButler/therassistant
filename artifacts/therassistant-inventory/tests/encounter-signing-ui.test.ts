import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url)),
  "utf8",
);

test("signing saves the current editable note before locking it", () => {
  const signStart = source.indexOf("async function sign()");
  const saveCall = source.indexOf("await saveClinicalNote(encounterId", signStart);
  const signCall = source.indexOf("await signEncounterNote(encounterId", signStart);

  assert.ok(signStart >= 0);
  assert.ok(saveCall > signStart, "Sign action must persist the current editor content.");
  assert.ok(signCall > saveCall, "The persisted current note must be saved before signature.");
});


test("diagnosis and service-line saves preserve an unsaved clinical draft", () => {
  const helperStart = source.indexOf("async function withSave(");
  const draftCapture = source.indexOf("const draft = preserveClinicalDraft", helperStart);
  const draftRestore = source.indexOf("setNoteText(draft.noteText)", helperStart);
  const diagnosisStart = source.indexOf("async function addDiagnosis()");
  const serviceStart = source.indexOf("async function addServiceLine()");
  const diagnosisEnd = source.indexOf("async function addServiceLine()", diagnosisStart);
  const serviceEnd = source.indexOf("async function sign()", serviceStart);

  assert.ok(helperStart >= 0 && draftCapture > helperStart && draftRestore > draftCapture);
  assert.match(source.slice(diagnosisStart, diagnosisEnd), /"Diagnosis added to encounter\.",\s*true,/);
  const serviceHandler = source.slice(serviceStart, serviceEnd);
  assert.match(serviceHandler, /withSave\(/);
  assert.match(serviceHandler, /true,\s*setServiceError,/);
  assert.match(serviceHandler, /updateEncounterServiceLine/);
});

test("empty note and missing signature provide direct correction instead of a silent disabled sign button",()=>{
  const sign = source.slice(source.indexOf("async function sign()"),source.indexOf("if (loading && !data)"));
  assert.match(sign,/if \(!noteText\.trim\(\)\)/);
  assert.match(sign,/noteRef\.current\?\.focus/);
  assert.match(sign,/if \(!signatureText\.trim\(\)\)/);
  assert.match(sign,/signatureRef\.current\?\.focus/);
  assert.match(source,/Go to Note Editor/);
  assert.match(source,/setData\(\(current\) => current \?/);
  assert.doesNotMatch(source,/disabled=\{saving \|\| !noteText\.trim\(\) \|\| !signatureText\.trim\(\)\}/);
});
