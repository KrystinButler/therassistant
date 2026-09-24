import test from "node:test";
import assert from "node:assert/strict";

import { evaluateBillingReadiness } from "../src/domains/readiness/evaluate-billing-readiness";
import { createChargeFromEncounterWorkflow } from "../src/domains/billing/workflow";

const base = {
  encounter: { id: "enc", payer_id: "payer", client_id: "client", provider_id: "provider" },
  note: { id: "note", note_status: "signed", service_date: "2026-09-23" },
  diagnoses: [{ diagnosis_code: "F41.1", is_primary: true }],
  serviceLines: [{
    id: "line", cpt_hcpcs_code: "90837", units: 1,
    charge_amount_cents: 15000, place_of_service_code: "02",
  }],
  eligibilityStatus: "active",
  providerEnrollmentStatus: "approved",
};

test("a conflicting funding source blocks billing, not clinical documentation", () => {
  const result = evaluateBillingReadiness({
    ...base,
    fundingSourceType: "government_program",
    billingPath: "insurance_claim",
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "funding_path_conflict" && c.blocking));
});

test("insurance path without a payer must not become claim-ready", () => {
  const result = evaluateBillingReadiness({
    ...base,
    encounter: { ...base.encounter, payer_id: null },
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some(c => c.code === "insurance_payer_missing" && c.blocking));
});

test("program funding without an agency warns without imposing an insurance gate", () => {
  const result = evaluateBillingReadiness({
    ...base,
    encounter: { ...base.encounter, payer_id: null },
    fundingSourceType: "government_program",
    billingPath: "program_invoice_voucher",
    fundingContext: {},
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
  });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(c => c.code === "program_billing_party_missing" && c.status === "warn"));
  assert.ok(!result.checks.some(c => c.code === "eligibility_not_active"));
});

test("specialty service flags code review without automatically denying a claim", () => {
  const result = evaluateBillingReadiness({
    ...base,
    encounter: { ...base.encounter, service_type: "ketamine_assisted" },
  });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(c => c.code === "specialty_claim_review" && !c.blocking));
});

test("a program charge with incomplete service line stays on hold instead of entering the program queue", async () => {
  const charges: Array<Record<string, any>> = [];
  const context = {
    ...base,
    encounter: { ...base.encounter, payer_id: null },
    fundingSourceType: "government_program",
    billingPath: "program_invoice_voucher",
    fundingContext: { responsible_entity: "Synthetic Program" },
    serviceLines: [{ ...base.serviceLines[0], place_of_service_code: "" }],
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
  };
  const repo = {
    async getBillingContext() { return context; },
    async replaceReadinessChecks() { return null; },
    async upsertWorkItem() { return null; },
    async resolveStaleWorkItems() { return null; },
    async updateEncounter() { return null; },
    async getExistingCharges() { return []; },
    async createCharge(values: Record<string, unknown>) { const row = { id: "charge", ...values }; charges.push(row); return row; },
    async updateCharge() { throw Error("unexpected update"); },
    async updateServiceLine() { return null; },
  };
  const result = await createChargeFromEncounterWorkflow(repo, "enc");
  assert.equal(result.ok, true);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].charge_status, "blocked");
  assert.match(String(charges[0].block_reason), /service line/i);
});
