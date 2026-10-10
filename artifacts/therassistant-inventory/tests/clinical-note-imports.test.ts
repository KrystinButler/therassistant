import test from "node:test";
import assert from "node:assert/strict";
import { cssrsImportNarrative, gadImportNarrative, phqImportNarrative } from "../src/domains/clinical/clinical-note-imports.ts";

test("screening imports map PHQ, GAD, and C-SSRS to distinct import numbers", () => {
  const outcomes = [
    { id: "phq-new", instrument: "PHQ-9", score: 12, assessed_on: "2026-10-10" },
    { id: "phq-old", instrument: "PHQ-9", score: 8, assessed_on: "2026-09-10" },
    { id: "gad-new", instrument: "GAD-7", score: 6, assessed_on: "2026-10-10" },
    { id: "gad-old", instrument: "GAD-7", score: 9, assessed_on: "2026-09-10" },
  ];
  const safety = [
    { id: "risk", instrument: "C-SSRS", score_text: "2", risk_level: "moderate", assessed_on: "2026-10-10", narrative: "Safety plan reviewed." },
  ];

  assert.match(phqImportNarrative(outcomes), /^IMPORT 3:/);
  assert.match(gadImportNarrative(outcomes), /^IMPORT 4:/);
  const risk = cssrsImportNarrative(safety);
  assert.match(risk, /^IMPORT 5:/);
  assert.match(risk, /C-SSRS/);
  assert.doesNotMatch(risk, /Anxiety has/i);
});
