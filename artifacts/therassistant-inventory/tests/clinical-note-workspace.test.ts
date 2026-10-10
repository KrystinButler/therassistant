import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workspace = () => readFileSync(fileURLToPath(new URL("../src/domains/clinical/ClinicalNoteWorkspace.tsx", import.meta.url)), "utf8");
const encounter = () => readFileSync(fileURLToPath(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url)), "utf8");
const repository = () => readFileSync(fileURLToPath(new URL("../src/domains/encounters/repository.ts", import.meta.url)), "utf8");

test("clinical note workspace matches the integrated note design", () => {
  const source = workspace();
  for (const label of ["Presenting Problem", "Session Focus", "Standardized Screenings", "Subjective", "Objective", "Assessment", "Plan", "Psychotherapy Note", "Coding Review", "CPT / HCPCS", "ICD-10"]) {
    assert.match(source, new RegExp(label, "i"));
  }
  assert.match(source, /PHQ-9/);
  assert.match(source, /GAD-7/);
  assert.match(source, /C-SSRS/);
  assert.match(source, /IMPORT 5/);
  assert.doesNotMatch(source, /Risk[\s\S]{0,240}IMPORT 4/i);
  assert.match(source, /private/i);
  assert.match(source, /collaps/i);
});

test("encounter loads screening data and renders the clinical note workspace", () => {
  assert.match(repository(), /clinical_outcome_measures/);
  assert.match(repository(), /outcomeMeasures/);
  assert.match(encounter(), /ClinicalNoteWorkspace/);
  assert.match(encounter(), /outcomeMeasures=\{data\.outcomeMeasures\}/);
});
