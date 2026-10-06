import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createChargeFromEncounterWorkflow } from "../src/domains/billing/workflow.ts";

// Substitute persistence and unrelated repository imports, while running the
// actual diagnosis writer and billing readiness/capture workflows.
const sources: Record<string, string> = {
  "../../lib/tenant-data-client": "export const getCurrentTenantId = () => { throw new Error('Unexpected timezone lookup in diagnosis-only test'); }; export const referenceSelect = () => { throw new Error('Unexpected reference lookup in diagnosis-only test'); }; export const tenantSelect = (...args) => globalThis.diagnosisHandoff.select(...args); export const tenantInsert = (...args) => globalThis.diagnosisHandoff.insert(...args); export const tenantUpdate = () => {}; export const tenantDelete = () => {}; export const tenantRpc = () => {};",
  "../billing/repository": "export const createChargeFromEncounter = (...args) => globalThis.diagnosisHandoff.capture(...args);",
  "../encounters/service-line-validation": "export const matchingServiceLineExists = () => false; export const validateServiceLineValues = () => {};",
  "./fast-charting-repository": "export const saveStructuredClinicalData = () => {};",
  "../encounters/repository": "export const updateEncounter = () => {};",
  "./workflow": "export const signNoteWorkflow = () => {};",
};
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/domains/clinical/repository.ts") && sources[specifier]) {
      return { url: "data:text/javascript," + encodeURIComponent(sources[specifier]), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { addEncounterDiagnosis } = await import("../src/domains/clinical/repository.ts");
hook.deregister();

function fixture(noteStatus = "signed", billingStatus = "held") {
  const encounter: Record<string, any> = {
    id: "enc-1", client_id: "client-1", provider_id: "provider-1",
    payer_id: "payer-1", billing_status: billingStatus,
  };
  const note = { id: "note-1", note_status: noteStatus, service_date: "2026-10-04", note_text: "Signed clinical record", locked_at: "2026-10-04T12:00:00Z" };
  const diagnoses: Record<string, any>[] = [];
  const serviceLines = [{ id: "line-1", cpt_hcpcs_code: "90837", units: 1, charge_amount_cents: 15000, place_of_service_code: "11" }];
  const charge: Record<string, any> = {
    id: "charge-1", encounter_id: "enc-1", service_line_id: "line-1",
    charge_status: billingStatus === "claimed" ? "claim_created" : "blocked",
    diagnosis_code: null, block_reason: "No encounter diagnosis is available for an insurance claim.",
  };
  const charges = [charge];
  const repo = {
    async getBillingContext() { return { encounter, note, diagnoses, serviceLines, eligibilityStatus: "active", providerEnrollmentStatus: "approved" }; },
    async replaceReadinessChecks() {}, async upsertWorkItem() {}, async resolveStaleWorkItems() {},
    async updateEncounter(_id: string, values: Record<string, unknown>) { Object.assign(encounter, values); },
    async getExistingCharges() { return charges; },
    async createCharge() { throw new Error("Existing service line must not produce a duplicate charge"); },
    async updateCharge(id: string, values: Record<string, unknown>) { assert.equal(id, "charge-1"); Object.assign(charge, values); return charge; },
    async updateServiceLine() {},
  };
  let captureCalls = 0;
  (globalThis as any).diagnosisHandoff = {
    async select(table: string) {
      if (table === "encounters") return [encounter];
      if (table === "clinical_notes") return [note];
      if (table === "encounter_diagnoses") return diagnoses;
      if (table === "encounter_service_lines") return serviceLines;
      throw new Error("Unexpected table: " + table);
    },
    async insert(table: string, values: Record<string, unknown>) {
      assert.equal(table, "encounter_diagnoses");
      const diagnosis = { id: "dx-1", ...values };
      diagnoses.push(diagnosis);
      return diagnosis;
    },
    async capture(encounterId: string) { captureCalls++; return createChargeFromEncounterWorkflow(repo, encounterId); },
  };
  return { encounter, note, diagnoses, charge, charges, repo, get captureCalls() { return captureCalls; } };
}

test("adding the missing diagnosis after signing releases the existing charge without changing the note", async () => {
  const state = fixture();
  const originalNote = { ...state.note };
  await addEncounterDiagnosis("enc-1", { diagnosisCode: "f41.1" });
  assert.equal(state.charge.diagnosis_code, "F41.1");
  assert.equal(state.charge.charge_status, "ready_for_claim");
  assert.equal(state.charge.block_reason, null);
  assert.equal(state.encounter.billing_status, "charged");
  assert.equal(state.charges.length, 1);
  assert.deepEqual(state.note, originalNote);
});

test("adding a diagnosis before signing does not capture a charge", async () => {
  const state = fixture("draft");
  await addEncounterDiagnosis("enc-1", { diagnosisCode: "F41.1" });
  assert.equal(state.captureCalls, 0);
  assert.equal(state.charge.charge_status, "blocked");
});

test("adding a diagnosis after claim creation leaves the captured claim charge unchanged", async () => {
  const state = fixture("signed", "claimed");
  const originalCharge = { ...state.charge };
  await addEncounterDiagnosis("enc-1", { diagnosisCode: "F41.1" });
  assert.deepEqual(state.charge, originalCharge);
  assert.equal(state.encounter.billing_status, "claimed");
});
