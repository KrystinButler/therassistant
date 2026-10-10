import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url)),
  "utf8",
);
const clinicalRepositorySource = readFileSync(
  fileURLToPath(new URL("../src/domains/clinical/repository.ts", import.meta.url)),
  "utf8",
);

test("Save Note and Sign & Lock are separate actions", () => {
  const signStart = source.indexOf("async function sign()");
  const signEnd = source.indexOf("if (loading && !data)", signStart);
  const signHandler = source.slice(signStart, signEnd);

  assert.ok(signStart >= 0 && signEnd > signStart);
  assert.doesNotMatch(signHandler, /saveClinicalNote\(/, "Sign & Lock must not save the editable note.");
  assert.match(signHandler, /noteHasUnsavedText/, "Unsaved note edits must be saved explicitly before signing.");
  assert.match(signHandler, /Save the note before signing/);
  assert.match(signHandler, /signEncounterNote\(/);
  assert.doesNotMatch(signHandler, /data\.diagnoses/);
  assert.doesNotMatch(signHandler, /data\.serviceLines/);
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
  assert.match(source.slice(diagnosisStart, diagnosisEnd), /"Diagnosis added and billing readiness refreshed\."/);
  assert.match(source.slice(diagnosisStart, diagnosisEnd), /true,\s*\);/);
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

test("signing ensures the current clinician is linked to the rendering provider before the signature RPC", () => {
  const signingRepoStart = clinicalRepositorySource.indexOf("const signingRepository");
  const linkCall = clinicalRepositorySource.indexOf('"link_current_user_to_provider"', signingRepoStart);
  const signCall = clinicalRepositorySource.indexOf('"sign_encounter_note"', signingRepoStart);

  assert.ok(signingRepoStart >= 0);
  assert.ok(linkCall > signingRepoStart, "Signing must ensure the clinician/provider identity link first.");
  assert.ok(signCall > linkCall, "The provider link must be ensured before the signature RPC runs.");
});
