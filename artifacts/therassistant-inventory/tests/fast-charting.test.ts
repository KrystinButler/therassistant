import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SMART_PHRASES,
  emptyStructuredSelections,
  expandSmartPhraseAtCursor,
  normalizeStructuredSelections,
  synthesizeStructuredNarrative,
} from "../src/domains/clinical/fast-charting";

test("SmartPhrase expands only an exact dot shortcut followed by space", () => {
  const input = "Assessment complete. .gad7 ";
  const result = expandSmartPhraseAtCursor(input, input.length, DEFAULT_SMART_PHRASES);
  assert.ok(result);
  assert.match(result.value, /GAD-7: Score ___\/21/);
  assert.equal(result.value.includes(".gad7"), false);
});

test("unknown SmartPhrase is left unchanged", () => {
  const input = ".unknown ";
  assert.equal(expandSmartPhraseAtCursor(input, input.length, DEFAULT_SMART_PHRASES), null);
});

test("structured narrative contains only clinician-selected content", () => {
  const selections = emptyStructuredSelections();
  selections.anxiety = "mild";
  selections.interventions = ["cognitive_reframing"];
  selections.response = "receptive";
  const narrative = synthesizeStructuredNarrative(selections);
  assert.match(narrative, /anxiety: mild/);
  assert.match(narrative, /cognitive reframing/);
  assert.match(narrative, /receptive/);
  assert.equal(narrative.includes("suicidal"), false);
});

test("documentation context defaults safely and preserves only known clinical tags", () => {
  const normalized = normalizeStructuredSelections({
    template_type: "forensic",
    clinical_tags: ["anxiety", "legal_forensic_context", "not-a-real-tag"],
  });

  assert.equal(normalized.templateType, "forensic");
  assert.deepEqual(normalized.clinicalTags, ["anxiety", "legal_forensic_context"]);

  const defaults = emptyStructuredSelections();
  assert.equal(defaults.templateType, "standard_therapy");
  assert.deepEqual(defaults.clinicalTags, []);
});
