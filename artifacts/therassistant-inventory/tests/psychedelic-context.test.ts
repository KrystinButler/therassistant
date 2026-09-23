import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyPsychedelicContext,
  formatPsychedelicContextForNote,
  normalizePsychedelicContext,
  psychedelicContextForCarryForward,
  psychedelicPhaseForTemplate,
} from "../src/domains/clinical/psychedelic-context";

test("PAT/KAP templates resolve to the expected documentation phase", () => {
  assert.equal(psychedelicPhaseForTemplate("pat_preparation"), "preparation");
  assert.equal(psychedelicPhaseForTemplate("kap_medicine_session"), "medicine_session");
  assert.equal(psychedelicPhaseForTemplate("pat_integration"), "integration");
  assert.equal(psychedelicPhaseForTemplate("standard_therapy"), "none");
});

test("psychedelic context keeps only supported provider-selected phenomena", () => {
  const context = normalizePsychedelicContext({
    phase: "medicine_session",
    treatment_model: "Ketamine-assisted psychotherapy",
    medicine_context: "Treating-team documentation reviewed.",
    phenomena: ["altered_sensory_perception", "grounding_return", "not-a-real-option"],
  });

  assert.equal(context.phase, "medicine_session");
  assert.equal(context.treatmentModel, "Ketamine-assisted psychotherapy");
  assert.deepEqual(context.phenomena, ["altered_sensory_perception", "grounding_return"]);
});

test("PAT/KAP carry-forward preserves model but clears prior-session observations", () => {
  const current = {
    ...emptyPsychedelicContext(),
    phase: "medicine_session" as const,
    treatmentModel: "Established treatment model",
    monitoringObservations: "Session-specific observation.",
    phenomena: ["dissociation" as const],
    providerNarrative: "Session-specific narrative.",
  };
  const next = psychedelicContextForCarryForward(current);
  assert.equal(next.treatmentModel, "Established treatment model");
  assert.equal(next.phase, "none");
  assert.equal(next.monitoringObservations, "");
  assert.deepEqual(next.phenomena, []);
  assert.equal(next.providerNarrative, "");
});

test("PAT/KAP note block is documentation-only and does not create treatment or coverage decisions", () => {
  const text = formatPsychedelicContextForNote({
    ...emptyPsychedelicContext(),
    phase: "integration",
    integrationThemes: "Patient discussed meaning and next-step goals.",
  });
  assert.match(text, /Patient discussed meaning and next-step goals/);
  assert.match(text, /does not generate dosing recommendations, medication protocols, diagnoses, or payer coverage determinations/);
});
