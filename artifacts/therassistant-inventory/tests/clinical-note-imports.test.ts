import test from "node:test";
import assert from "node:assert/strict";
import { cssrsImportNarrative, gadImportNarrative, phqImportNarrative } from "../src/domains/clinical/clinical-note-imports.ts";

test("screening imports map PHQ, GAD, and C-SSRS to readable instrument names", () => {
  const outcomes = [
    { id: "phq-new", instrument: "PHQ-9", score: 12, assessed_on: "2026-10-10" },
    { id: "phq-old", instrument: "PHQ-9", score: 8, assessed_on: "2026-09-10" },
    { id: "gad-new", instrument: "GAD-7", score: 6, assessed_on: "2026-10-10" },
    { id: "gad-old", instrument: "GAD-7", score: 9, assessed_on: "2026-09-10" },
  ];
  const safety = [
    { id: "risk", instrument: "C-SSRS", score_text: "2", risk_level: "moderate", assessed_on: "2026-10-10", narrative: "Safety plan reviewed." },
  ];

  assert.match(phqImportNarrative(outcomes), /^PHQ-9:/);
  assert.match(gadImportNarrative(outcomes), /^GAD-7:/);
  const risk = cssrsImportNarrative(safety);
  assert.match(risk, /^C-SSRS:/);
  assert.match(risk, /C-SSRS/);
  assert.doesNotMatch(risk, /Anxiety has/i);
});
