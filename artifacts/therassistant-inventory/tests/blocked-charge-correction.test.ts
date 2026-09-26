import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChargeFromEncounterWorkflow } from "../src/domains/billing/workflow";

const clinical = readFileSync(new URL("../src/domains/clinical/repository.ts", import.meta.url), "utf8");
const encounter = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");

test("blocked and ready-for-claim charges can be corrected before claim creation, but captured charges remain locked", () => {
  assert.match(clinical, /allowBlockedCorrection && \["blocked", "ready_for_claim"\]/);
  assert.match(clinical, /if \(claims\.length\) throw new Error/);
  assert.match(clinical, /assertUnbilledLine\(encounterId, lineId, true\)/);
  assert.match(encounter, /removableLineIds/);
  assert.match(encounter, /voidPreclaimServiceLine/);
  assert.match(encounter, /Recheck Billing/);
  assert.match(encounter, /!signed \|\| data\.claims\.length === 0/);
  assert.match(encounter, /disabled=\{saving \|\| !removableLineIds\.has/);
});

test("signed encounter gives missing charge a direct amount correction and resyncs existing charge", () => {
  assert.match(encounter, /Fix amount →/);
  assert.match(encounter, /id="encounter-charge-amount"/);
  assert.match(encounter, /await createChargeFromEncounter\(encounterId\)/);
  assert.match(encounter, /Reconcile Charges/);
});

test("canonical reconciliation updates blocked charge in place without duplicating it", async () => {
  const updated: Array<Record<string, any>> = [];
  let created = 0;
  const existing = {
    id: "charge-1", service_line_id: "line-1",
    charge_status: "blocked", charge_amount_cents: 0,
  };
  const context = {
    encounter: { id: "enc-1", tenant_id: "tenant-1", client_id: "patient-1", provider_id: "provider-1", payer_id: "payer-1", started_at: "2026-09-25" },
    note: { id: "note-1", note_status: "signed", service_date: "2026-09-25" },
    diagnoses: [{ diagnosis_code: "F41.1", is_primary: true }],
    serviceLines: [{ id: "line-1", cpt_hcpcs_code: "90837", units: 1, charge_amount_cents: 25000, place_of_service_code: "02" }],
    eligibilityStatus: "active", providerEnrollmentStatus: "approved",
    fundingSourceType: "insurance", billingPath: "insurance_claim",
  };
  const repo = {
    async getBillingContext() { return context; },
    async replaceReadinessChecks() { return null; },
    async upsertWorkItem() { return null; },
    async resolveStaleWorkItems() { return null; },
    async updateEncounter() { return null; },
    async getExistingCharges() { return [existing]; },
    async createCharge() { created++; throw new Error("Unexpected duplicate charge"); },
    async updateCharge(id: string, values: Record<string, unknown>) {
      updated.push({ id, ...values }); return { id, ...values };
    },
    async updateServiceLine() { return null; },
  };
  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(created, 0);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, "charge-1");
  assert.equal(updated[0].charge_amount_cents, 25000);
  assert.equal(updated[0].charge_status, "ready_for_claim");
});