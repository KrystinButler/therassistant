import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("clinical note save hook appends the cross-system scope disclaimer when the saved note uses a mapped condition", () => {
  const source = read("../src/domains/clinical/repository.ts");
  assert.match(source, /evaluateCrossSystemEngine/);
  assert.match(source, /appendScopeDisclaimer/);
  assert.match(source, /finalNoteText/);
  assert.match(source, /note_text:\s*finalNoteText/);
});

test("patient-generated and import text is sanitized and appended rather than overwriting the clinical note", () => {
  const encounter = read("../src/domains/encounters/EncounterPage.tsx");
  assert.match(encounter, /appendImportedText/);
  assert.match(encounter, /sanitizeImportedText/);
  assert.match(encounter, /appendClinicalSource\(current, sanitizeImportedText\(preVisitInsert\)\)/);
  assert.match(encounter, /appendClinicalSource\(current, sanitizeImportedText\(journalInsert\)\)/);
});

test("encounter continuously evaluates the workspace and floats matched somatic SmartPhrases", () => {
  const encounter = read("../src/domains/encounters/EncounterPage.tsx");
  assert.match(encounter, /evaluateCrossSystemEngine/);
  assert.match(encounter, /crossSystemEvaluation/);
  assert.match(encounter, /Suggested SmartPhrases/i);
  assert.match(encounter, /matchedRules/);
  assert.match(encounter, /macroText/);
});

test("emergency and coding safety prompts are disruptive, explicit, and rejection requires justification", () => {
  const encounter = read("../src/domains/encounters/EncounterPage.tsx");
  assert.match(encounter, /Cross-System Safety Alert/i);
  assert.match(encounter, /Coding Safety Review/i);
  assert.match(encounter, /rejectionJustification/);
  assert.match(encounter, /Apply Suggested Sequence/i);
  assert.match(encounter, /Keep Current Coding/i);
});

test("coding recommendations are applied or rejected through tenant-scoped database RPCs instead of silent diagnosis mutation", () => {
  const repository = read("../src/domains/clinical/repository.ts");
  const migration = read("../../../supabase/migrations/20261010203000_cross_system_clinical_engine.sql");
  assert.match(repository, /applyCrossSystemDiagnosisSequence/);
  assert.match(repository, /rejectCrossSystemCodingRecommendation/);
  assert.match(repository, /apply_cross_system_diagnosis_sequence/);
  assert.match(repository, /record_cross_system_coding_rejection/);
  assert.match(migration, /create or replace function public\.apply_cross_system_diagnosis_sequence/i);
  assert.match(migration, /create or replace function public\.record_cross_system_coding_rejection/i);
  assert.match(migration, /professional_claims/i);
  assert.match(migration, /present_on_claim=false/i);
  assert.doesNotMatch(migration, /delete from public\.encounter_diagnoses/i);
});
