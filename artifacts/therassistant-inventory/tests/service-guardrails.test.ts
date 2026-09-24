import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBillingReadiness } from "../src/domains/readiness/evaluate-billing-readiness";

const base = {
  encounter: { id: "enc", provider_id: "provider", payer_id: "payer" },
  note: { note_status: "signed", psychotherapy_minutes: 45 },
  diagnoses: [{ diagnosis_code: "F41.1", is_primary: true }],
  serviceLines: [{ id: "line", cpt_hcpcs_code: "90834", units: 1, charge_amount_cents: 15000, place_of_service_code: "02" }],
  eligibilityStatus: "active",
  providerEnrollmentStatus: "approved",
  provider: { id: "provider", npi: "1234567890" },
  appointment: { starts_at: "2026-09-23T14:00:00Z", ends_at: "2026-09-23T15:00:00Z" },
};

test("documented 45 minutes supports time-based psychotherapy code 90834", () => {
  const result = evaluateBillingReadiness(base);
  assert.equal(result.ready, true);
  assert.equal(result.checks.some(c => c.code.startsWith("psychotherapy_duration_conflict")), false);
});

test("documented psychotherapy time outside selected code range holds billing only", () => {
  const result = evaluateBillingReadiness({
    ...base,
    serviceLines: [{ ...base.serviceLines[0], cpt_hcpcs_code: "90837" }],
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "psychotherapy_duration_conflict_0" && c.blocking));
});

test("scheduled appointment is not treated as documented psychotherapy duration", () => {
  const result = evaluateBillingReadiness({ ...base, note: { note_status: "signed" } });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(c => c.code === "psychotherapy_duration_unverified_0" && !c.blocking));
});

test("recorded duration longer than appointment is an advisory review", () => {
  const result = evaluateBillingReadiness({
    ...base,
    appointment: { starts_at: "2026-09-23T14:00:00Z", ends_at: "2026-09-23T14:30:00Z" },
  });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(c => c.code === "psychotherapy_exceeds_schedule_0" && c.status === "warn"));
});

test("psychotherapy E/M add-on without an E/M line is held in billing", () => {
  const result = evaluateBillingReadiness({
    ...base,
    serviceLines: [{ ...base.serviceLines[0], cpt_hcpcs_code: "90836" }],
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "psychotherapy_em_missing_0" && c.blocking));
});

test("psychotherapy E/M add-on with E/M line is not held solely for pairing", () => {
  const result = evaluateBillingReadiness({
    ...base,
    serviceLines: [
      { ...base.serviceLines[0], cpt_hcpcs_code: "90836" },
      { ...base.serviceLines[0], id: "em", cpt_hcpcs_code: "99214" },
    ],
  });
  assert.equal(result.ready, true);
  assert.equal(result.checks.some(c => c.code === "psychotherapy_em_missing_0"), false);
});

test("missing rendering provider holds an insurance claim", () => {
  const result = evaluateBillingReadiness({ ...base, encounter: { ...base.encounter, provider_id: null } });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "billing_provider_missing" && c.blocking));
});

test("missing NPI warns without assuming the provider is ineligible", () => {
  const result = evaluateBillingReadiness({ ...base, provider: { id: "provider" } });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(c => c.code === "billing_provider_npi_missing" && !c.blocking));
});

test("program funding is not subject to insurance psychotherapy time or NPI gates", () => {
  const result = evaluateBillingReadiness({
    ...base,
    encounter: { id: "enc", provider_id: "provider", payer_id: null },
    provider: { id: "provider" },
    billingPath: "program_invoice_voucher",
    fundingSourceType: "government_program",
    fundingContext: { responsible_entity: "Synthetic Program" },
    note: { note_status: "signed", psychotherapy_minutes: 20 },
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
  });
  assert.equal(result.ready, true);
  assert.equal(result.checks.some(c => c.code.startsWith("psychotherapy_duration_conflict")), false);
});

test("service checks never change clinical signing status", () => {
  const result = evaluateBillingReadiness({
    ...base,
    note: { note_status: "draft", psychotherapy_minutes: 15 },
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "note_unsigned"));
});

test("stored structured clinical-note duration takes precedence over unavailable legacy note fields", () => {
  const result = evaluateBillingReadiness({
    ...base,
    note: { note_status: "signed" },
    documentedPsychotherapyMinutes: 45,
  });
  assert.equal(result.ready, true);
  assert.equal(result.checks.some(c => c.code.startsWith("psychotherapy_duration_unverified")), false);
});

test("stored structured psychotherapy time inconsistency is held in billing", () => {
  const result = evaluateBillingReadiness({
    ...base,
    note: { note_status: "signed" },
    documentedPsychotherapyMinutes: 45,
    serviceLines: [{ ...base.serviceLines[0], cpt_hcpcs_code: "90837" }],
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "psychotherapy_duration_conflict_0" && c.blocking));
});
