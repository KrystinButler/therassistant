import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyForensicContext,
  forensicContextForCarryForward,
  formatForensicContextForNote,
  normalizeForensicContext,
} from "../src/domains/clinical/forensic-context";

test("forensic context keeps provider-entered progress and assessment references only", () => {
  const context = normalizeForensicContext({
    framework: "somb_adult",
    referral_source: "Parole",
    standards_reviewed_on: "2026-09-23",
    progress: {
      attendance: "stable",
      engagement: "improving",
      accountability: "needs_attention",
      responsivity: "not_assessed",
      skill_application: "improving",
    },
    assessment_references: [
      { name: "Assessment result", date: "2026-09-22", result_summary: "See filed report." },
      { name: "", date: "2026-09-22" },
    ],
    dynamic_treatment_needs: "Provider-entered dynamic need.",
  });

  assert.equal(context.framework, "somb_adult");
  assert.equal(context.assessmentReferences.length, 1);
  assert.equal(context.progress.engagement, "improving");
  assert.equal("riskScore" in context, false);
  assert.equal("complianceStatus" in context, false);
});

test("forensic carry-forward preserves framework but clears session-specific observations", () => {
  const current = {
    ...emptyForensicContext(),
    framework: "dvomb_adult" as const,
    referralSource: "Probation",
    standardsReviewedOn: "2026-09-23",
    providerNarrative: "Current-session narrative",
    dynamicTreatmentNeeds: "Current-session needs",
    progress: { ...emptyForensicContext().progress, engagement: "improving" as const },
    assessmentReferences: [{ name: "Assessment", date: "2026-09-20", resultSummary: "Filed." }],
  };
  const next = forensicContextForCarryForward(current);
  assert.equal(next.framework, "dvomb_adult");
  assert.equal(next.referralSource, "Probation");
  assert.equal(next.providerNarrative, "");
  assert.equal(next.dynamicTreatmentNeeds, "");
  assert.equal(next.progress.engagement, "");
  assert.deepEqual(next.assessmentReferences, []);
});

test("forensic note block explicitly avoids automated risk/compliance claims", () => {
  const context = {
    ...emptyForensicContext(),
    framework: "justice_involved" as const,
    providerNarrative: "Observed treatment progress.",
    progress: { ...emptyForensicContext().progress, engagement: "stable" as const },
  };
  const text = formatForensicContextForNote(context);
  assert.match(text, /Observed treatment progress/);
  assert.match(text, /does not calculate a risk score or determine standards compliance/);
});
