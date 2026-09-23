import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SMART_PHRASES,
  clinicalNoteSimilarity,
  emptyStructuredSelections,
  expandSmartPhraseAtCursor,
  formatTimelineForNote,
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
  assert.equal(defaults.forensicContext.framework, "none");
});

test("timeline events normalize safely and format into signed-note text", () => {
  const normalized = normalizeStructuredSelections({
    timeline_events: [
      { time: "14:05", label: "Grounding intervention", detail: "Patient reported reduced distress." },
      { time: "99:99", label: "Invalid event", detail: "" },
    ],
  });
  assert.deepEqual(normalized.timelineEvents, [
    { time: "14:05", label: "Grounding intervention", detail: "Patient reported reduced distress." },
  ]);
  assert.match(formatTimelineForNote(normalized.timelineEvents), /\[14:05\] Grounding intervention/);
});

test("note similarity flags near-cloned long notes but ignores short text", () => {
  const prior = Array.from({ length: 12 }, (_, index) =>
    `Session segment ${index} reviewed anxiety symptoms coping skills treatment progress and patient response.`
  ).join(" ");
  const clone = prior + " Plan updated for the next visit.";
  const different = Array.from({ length: 12 }, (_, index) =>
    `Distinct topic ${index} addressed sleep routine vocational goals family communication medication questions and scheduling.`
  ).join(" ");

  assert.ok(clinicalNoteSimilarity(clone, prior) > 0.85);
  assert.ok(clinicalNoteSimilarity(different, prior) < 0.3);
  assert.equal(clinicalNoteSimilarity("brief note", prior), 0);
});

test("forensic context is normalized without calculating a risk score", async () => {
  const { normalizeStructuredSelections } = await import("../src/domains/clinical/fast-charting");
  const normalized = normalizeStructuredSelections({
    template_type: "forensic",
    forensic_context: {
      framework: "dvomb_adult",
      referral_source: "Probation",
      standards_reviewed_on: "2026-09-23",
      progress: {
        attendance: "improving",
        engagement: "stable",
        accountability: "needs_attention",
        responsivity: "not_assessed",
        skill_application: "improving",
      },
      assessment_references: [
        { name: "Provider assessment reference", date: "2026-09-20", result_summary: "Filed in chart." },
      ],
    },
  });

  assert.equal(normalized.forensicContext.framework, "dvomb_adult");
  assert.equal(normalized.forensicContext.referralSource, "Probation");
  assert.equal(normalized.forensicContext.progress.accountability, "needs_attention");
  assert.equal(normalized.forensicContext.assessmentReferences.length, 1);
  assert.equal("riskScore" in normalized.forensicContext, false);
});
