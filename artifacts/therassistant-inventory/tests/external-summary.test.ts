import assert from "node:assert/strict";
import test from "node:test";

import { emptyStructuredSelections } from "../src/domains/clinical/fast-charting";
import {
  DEFAULT_EXTERNAL_SUMMARY_OPTIONS,
  buildExternalTreatmentSummary,
} from "../src/domains/clinical/external-summary";

test("external summary defaults to minimum-necessary clinical content", () => {
  const selections = emptyStructuredSelections();
  selections.interventions = ["supportive"];
  selections.response = "engaged";
  selections.risk = "safety_plan_reviewed";
  selections.clinicalTags = ["legal_forensic_context"];
  selections.timelineEvents = [
    { time: "14:05", label: "Grounding intervention", detail: "Patient response documented." },
  ];

  const summary = buildExternalTreatmentSummary(
    {
      patientName: "Synthetic Patient",
      providerName: "Synthetic Provider",
      serviceDate: "2026-09-23",
      serviceType: "Individual Therapy",
      attendanceStatus: "completed",
      goalAddressed: "Practice coping skills",
      selections,
      diagnoses: [{ code: "F41.1", description: "Generalized anxiety disorder" }],
    },
    DEFAULT_EXTERNAL_SUMMARY_OPTIONS,
  );

  assert.match(summary, /Practice coping skills/);
  assert.match(summary, /Supportive psychotherapy/);
  assert.match(summary, /Engaged/);
  assert.equal(summary.includes("F41.1"), false);
  assert.equal(summary.includes("Safety planning"), false);
  assert.equal(summary.includes("Legal \/ forensic context"), false);
  assert.equal(summary.includes("SESSION TIMELINE"), false);
});

test("sensitive external summary sections appear only when explicitly enabled", () => {
  const selections = emptyStructuredSelections();
  selections.risk = "safety_plan_reviewed";
  selections.clinicalTags = ["legal_forensic_context"];
  selections.timelineEvents = [
    { time: "14:05", label: "Grounding intervention", detail: "Patient response documented." },
  ];

  const summary = buildExternalTreatmentSummary(
    {
      patientName: "Synthetic Patient",
      providerName: "Synthetic Provider",
      serviceDate: "2026-09-23",
      serviceType: "Individual Therapy",
      attendanceStatus: "completed",
      goalAddressed: "",
      selections,
      diagnoses: [{ code: "F41.1", description: "Generalized anxiety disorder" }],
    },
    {
      ...DEFAULT_EXTERNAL_SUMMARY_OPTIONS,
      includeDiagnoses: true,
      includeRisk: true,
      includeClinicalTags: true,
      includeTimeline: true,
    },
  );

  assert.match(summary, /F41.1/);
  assert.match(summary, /Safety planning was reviewed/);
  assert.match(summary, /Legal \/ forensic context/);
  assert.match(summary, /SESSION TIMELINE/);
});
