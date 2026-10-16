import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildClinicalTelemetry } from "../src/domains/clinical/clinical-telemetry.ts";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("cross-system SmartPhrase shortcuts are defined in the versioned engine", () => {
  const source = read("../src/domains/clinical/cross-system-engine.ts");
  for (const shortcut of [".somaticGI", ".somaticPain", ".somaticCardio", ".somaticSUD"]) assert.match(source, new RegExp(shortcut.replace(".", "\\.")));
});

test("telemetry builds a rolling 90-day PHQ-9 GAD-7 and PRSDS series", () => {
  const points = buildClinicalTelemetry([
    { instrument: "PHQ-9", score: 12, assessed_on: "2026-10-10" },
    { instrument: "GAD-7", score: 8, assessed_on: "2026-10-10" },
    { instrument: "PRSDS", score: 7, assessed_on: "2026-10-10" },
    { instrument: "PHQ-9", score: 20, assessed_on: "2026-07-01" },
  ], "2026-10-10");
  assert.deepEqual(points, [{ date: "2026-10-10", phq9: 12, gad7: 8, prsds: 7 }]);
});

test("patient check-in captures PRSDS and the migration syncs submitted scores into outcome telemetry", () => {
  const portal = read("../src/domains/portal/PatientCheckInPage.tsx");
  const migration = read("../../../supabase/migrations/20261010203000_cross_system_clinical_engine.sql");
  assert.match(portal, /somatic_distress_score/);
  assert.match(portal, /Physical \/ somatic distress/i);
  assert.match(migration, /sync_previsit_prsds/i);
  assert.match(migration, /source_reference_id/i);
  assert.match(migration, /'PRSDS'/);
});

test("clinical workspace renders the 90-day three-series telemetry chart", () => {
  const workspace = read("../src/domains/clinical/ClinicalNoteWorkspace.tsx");
  const chart = read("../src/domains/clinical/ClinicalTelemetryChart.tsx");
  assert.match(workspace, /ClinicalTelemetryChart/);
  assert.match(chart, /90-DAY/i);
  assert.match(chart, /PHQ-9/);
  assert.match(chart, /GAD-7/);
  assert.match(chart, /PRSDS/);
});

test("clinician workspace exposes a visible clinical signals strip and cross-system review controls", () => {
  const workspace = read("../src/domains/clinical/ClinicalNoteWorkspace.tsx");
  assert.match(workspace, /Screening & trends/i);
  assert.match(workspace, /Cross-System Monitoring/i);
  assert.match(workspace, /Review Recommendation/i);
  assert.match(workspace, /Safety trigger detected/i);
});

test("coding safety review compares current and recommended diagnosis sequences", () => {
  const workspace = read("../src/domains/clinical/ClinicalNoteWorkspace.tsx");
  const encounter = read("../src/domains/encounters/EncounterPage.tsx");
  assert.match(workspace, /Current diagnosis sequence/i);
  assert.match(workspace, /Recommended sequence/i);
  assert.match(encounter, /Apply Suggested Sequence/i);
  assert.match(encounter, /Keep Current Coding/i);
});

test("patient PRSDS input uses a visible 1-10 rating control instead of a plain select", () => {
  const portal = read("../src/domains/portal/PatientCheckInPage.tsx");
  assert.match(portal, /pci-prsds-rating/);
  assert.match(portal, /Low physical symptom impact/i);
  assert.match(portal, /High physical symptom impact/i);
  assert.doesNotMatch(portal, /<select value=\{visitQuestions\.somatic_distress_score/);
});

test("90-day telemetry card shows latest scores and trend direction without hover", () => {
  const chart = read("../src/domains/clinical/ClinicalTelemetryChart.tsx");
  assert.match(chart, /Latest scores/i);
  assert.match(chart, /Trend/i);
  assert.match(chart, /latestClinicalTelemetrySnapshot/);
});
