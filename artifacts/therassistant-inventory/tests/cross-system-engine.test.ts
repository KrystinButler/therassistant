import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_OF_PRACTICE_SAFETY_NOTE,
  appendImportedText,
  appendScopeDisclaimer,
  evaluateCrossSystemEngine,
  sanitizeImportedText,
} from "../src/domains/clinical/cross-system-engine.ts";

test("import sanitation strips emoji/control formatting and caps imported containers at 2000 characters", () => {
  const cleaned = sanitizeImportedText("Pain 🚨\u0000\n" + "x".repeat(2100));
  assert.equal(cleaned.includes("🚨"), false);
  assert.equal(cleaned.includes("\u0000"), false);
  assert.equal(cleaned.length, 2000);
});

test("imports append with a paragraph break instead of overwriting existing text", () => {
  assert.equal(appendImportedText("Clinician text.", "Patient response."), "Clinician text.\n\nPatient response.");
  assert.equal(appendImportedText("", "Patient response."), "Patient response.");
});

test("somatic rules surface exact configured SmartPhrase shortcuts and emergency triggers ignore negated phrases", () => {
  const matched = evaluateCrossSystemEngine({ narrativeText: "Client reports IBS, cramping, and nausea.", diagnosisCodes: ["F41.1"] });
  assert.equal(matched.matchedRules[0]?.id, "SOM-001");
  assert.equal(matched.matchedRules[0]?.dotPhrase, ".somaticGI");

  const emergency = evaluateCrossSystemEngine({ narrativeText: "Client reports persistent vomiting today.", diagnosisCodes: ["F41.1"] });
  assert.equal(emergency.emergencyAlerts.length, 1);
  const negated = evaluateCrossSystemEngine({ narrativeText: "Client denies persistent vomiting and bloody stool.", diagnosisCodes: ["F41.1"] });
  assert.equal(negated.emergencyAlerts.length, 0);
});

test("substance-induced psychosis rules recommend configured combination codes and detect the duplication trap", () => {
  const result = evaluateCrossSystemEngine({ narrativeText: "Active alcohol abuse with delusions.", diagnosisCodes: ["F10.10", "F22"] });
  assert.equal(result.combinationSuggestion?.code, "F10.150");
  assert.equal(result.combinationSuggestion?.duplicationTrap, true);
  assert.equal(result.combinationSuggestion?.blockingBillingIssue, true);
});

test("F54 sequence is produced in mental-health, F54, somatic order without silently changing existing codes", () => {
  const result = evaluateCrossSystemEngine({ narrativeText: "Anxiety worsens IBS and stomach pain.", diagnosisCodes: ["K58.9", "F41.1"] });
  assert.deepEqual(result.suggestedDiagnosisSequence?.map((item) => item.code), ["F41.1", "F54", "K58.9"]);
  assert.deepEqual(result.originalDiagnosisCodes, ["K58.9", "F41.1"]);
});

test("scope disclaimer is appended once when a cross-system rule is used", () => {
  const once = appendScopeDisclaimer("Clinical narrative.", true);
  assert.match(once, /SCOPE OF PRACTICE SAFETY NOTE/);
  assert.equal(once.endsWith(SCOPE_OF_PRACTICE_SAFETY_NOTE), true);
  assert.equal(appendScopeDisclaimer(once, true), once);
  assert.equal(appendScopeDisclaimer("Clinical narrative.", false), "Clinical narrative.");
});
