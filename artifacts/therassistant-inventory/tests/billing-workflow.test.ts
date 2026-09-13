import test from "node:test";
import assert from "node:assert/strict";

import { evaluateBillingReadiness } from "../src/domains/readiness/evaluate-billing-readiness.ts";
import {
  createChargeFromEncounterWorkflow,
  routeEncounterToBillingWorkflow,
} from "../src/domains/billing/workflow.ts";

const cleanContext = {
  encounter: { id: "enc-1", client_id: "client-1", provider_id: "provider-1", payer_id: "payer-1", appointment_id: "appt-1" },
  note: { id: "note-1", note_status: "signed", service_date: "2026-09-13" },
  diagnoses: [{ id: "dx-1", diagnosis_code: "F41.1", is_primary: true }],
  serviceLines: [{ id: "line-1", cpt_hcpcs_code: "90837", units: 1, charge_amount_cents: 17500, place_of_service_code: "02" }],
  eligibilityStatus: "active",
  authorizationRequired: false,
  authorizationStatus: null,
  remainingUnits: null,
  providerEnrollmentStatus: "approved",
};

test("unsigned note blocks billing readiness", () => {
  const result = evaluateBillingReadiness({ ...cleanContext, note: { ...cleanContext.note, note_status: "draft" } });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((check) => check.code === "note_unsigned" && check.blocking));
});

test("credentialing failure blocks billing readiness", () => {
  const result = evaluateBillingReadiness({ ...cleanContext, providerEnrollmentStatus: "submitted" });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((check) => check.code === "provider_enrollment" && check.blocking));
});

test("signed complete encounter is billing ready", () => {
  const result = evaluateBillingReadiness(cleanContext);
  assert.equal(result.ready, true);
  assert.equal(result.checks.some((check) => check.blocking), false);
});

function fakeRepo(context = cleanContext) {
  const readinessChecks: Array<Record<string, unknown>> = [];
  const work: Array<Record<string, unknown>> = [];
  const charges: Array<Record<string, any>> = [];
  let encounterUpdate: Record<string, unknown> = {};

  return {
    readinessChecks,
    work,
    charges,
    get encounterUpdate() { return encounterUpdate; },
    async getBillingContext() { return context; },
    async replaceReadinessChecks(_encounterId: string, checks: Array<Record<string, unknown>>) { readinessChecks.splice(0, readinessChecks.length, ...checks); },
    async upsertWorkItem(values: Record<string, unknown>) { work.push(values); return values; },
    async updateEncounter(_id: string, values: Record<string, unknown>) { encounterUpdate = values; return values; },
    async getExistingCharges() { return charges; },
    async createCharge(values: Record<string, unknown>) { const row = { id: `charge-${charges.length + 1}`, ...values }; charges.push(row); return row; },
    async updateServiceLine() { return {}; },
  };
}

test("blocked encounter is held and creates focused work", async () => {
  const repo = fakeRepo({ ...cleanContext, providerEnrollmentStatus: "submitted" });
  const result = await routeEncounterToBillingWorkflow(repo, "enc-1");
  assert.equal(result.ok, false);
  assert.equal(repo.encounterUpdate.billing_status, "held");
  assert.equal(repo.work.length, 1);
  assert.equal(repo.work[0].workqueue_type, "credentialing_issue");
});

test("ready encounter routes to billing without exception work", async () => {
  const repo = fakeRepo();
  const result = await routeEncounterToBillingWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.encounterUpdate.billing_status, "ready");
  assert.equal(repo.work.length, 0);
});

test("ready encounter creates traceable ready-for-claim charge", async () => {
  const repo = fakeRepo();
  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges.length, 1);
  assert.equal(repo.charges[0].encounter_id, "enc-1");
  assert.equal(repo.charges[0].charge_status, "ready_for_claim");
  assert.equal(repo.encounterUpdate.billing_status, "charged");
});
