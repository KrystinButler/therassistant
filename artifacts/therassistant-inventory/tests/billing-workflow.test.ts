import test from "node:test";
import assert from "node:assert/strict";

import { evaluateBillingReadiness } from "../src/domains/readiness/evaluate-billing-readiness.ts";
import {
  createChargeFromEncounterWorkflow,
  routeEncounterToBillingWorkflow,
} from "../src/domains/billing/workflow.ts";

const cleanContext = {
  encounter: {
    id: "enc-1",
    client_id: "client-1",
    provider_id: "provider-1",
    payer_id: "payer-1",
    appointment_id: "appt-1",
  },
  note: { id: "note-1", note_status: "signed", service_date: "2026-09-13" },
  diagnoses: [{ id: "dx-1", diagnosis_code: "F41.1", is_primary: true }],
  serviceLines: [{
    id: "line-1",
    cpt_hcpcs_code: "90837",
    units: 1,
    charge_amount_cents: 17500,
    place_of_service_code: "02",
  }],
  fundingSourceType: "insurance",
  fundingSourceSubtype: "commercial",
  billingPath: "insurance_claim",
  fundingContext: {},
  eligibilityStatus: "active",
  providerEnrollmentStatus: "approved",
};

test("unsigned note blocks billing readiness", () => {
  const result = evaluateBillingReadiness({
    ...cleanContext,
    note: { ...cleanContext.note, note_status: "draft" },
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((check) => check.code === "note_unsigned" && check.blocking));
});

test("credentialing failure blocks billing readiness", () => {
  const result = evaluateBillingReadiness({ ...cleanContext, providerEnrollmentStatus: "submitted" });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((check) => check.code === "provider_enrollment" && check.blocking));
});

test("needs revalidation remains billing ready but surfaces a participation warning", () => {
  const result = evaluateBillingReadiness({ ...cleanContext, providerEnrollmentStatus: "needs_revalidation" });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(
    (check) => check.code === "provider_revalidation_due" && check.status === "warn" && !check.blocking,
  ));
});

test("signed complete encounter is billing ready", () => {
  const result = evaluateBillingReadiness(cleanContext);
  assert.equal(result.ready, true);
  assert.equal(result.checks.some((check) => check.blocking), false);
});

test("billing readiness contains no authorization gate", () => {
  const result = evaluateBillingReadiness(cleanContext);
  assert.equal(
    result.checks.some((check) => check.code.startsWith("authorization")),
    false,
  );
});

function fakeRepo(context: any = cleanContext, initialCharges: Array<Record<string, any>> = []) {
  const readinessChecks: Array<Record<string, unknown>> = [];
  const work: Array<Record<string, unknown>> = [];
  const charges: Array<Record<string, any>> = initialCharges.map((row) => ({ ...row }));
  const resolvedWorkTypes: string[][] = [];
  const serviceLineUpdates: Array<{ id: string; values: Record<string, unknown> }> = [];
  let encounterUpdate: Record<string, unknown> = {};

  return {
    readinessChecks,
    work,
    charges,
    resolvedWorkTypes,
    serviceLineUpdates,
    get encounterUpdate() { return encounterUpdate; },
    async getBillingContext() { return context; },
    async replaceReadinessChecks(_encounterId: string, checks: Array<Record<string, unknown>>) {
      readinessChecks.splice(0, readinessChecks.length, ...checks);
    },
    async upsertWorkItem(values: Record<string, unknown>) {
      work.push(values);
      return values;
    },
    async resolveStaleWorkItems(_encounterId: string, activeTypes: string[]) {
      resolvedWorkTypes.push(activeTypes);
      return {};
    },
    async updateEncounter(_id: string, values: Record<string, unknown>) {
      encounterUpdate = values;
      return values;
    },
    async getExistingCharges() {
      return charges;
    },
    async createCharge(values: Record<string, unknown>) {
      const row = { id: `charge-${charges.length + 1}`, ...values };
      charges.push(row);
      return row;
    },
    async updateCharge(id: string, values: Record<string, unknown>) {
      const index = charges.findIndex((row) => row.id === id);
      if (index < 0) throw new Error("Charge not found");
      charges[index] = { ...charges[index], ...values };
      return charges[index];
    },
    async updateServiceLine(id: string, values: Record<string, unknown>) {
      serviceLineUpdates.push({ id, values });
      return {};
    },
  };
}

test("blocked encounter keeps clinical status separate and creates work for every billing queue", async () => {
  const repo = fakeRepo({
    ...cleanContext,
    eligibilityStatus: "inactive",
    providerEnrollmentStatus: "submitted",
    serviceLines: [],
  });
  const result = await routeEncounterToBillingWorkflow(repo, "enc-1");
  assert.equal(result.ok, false);
  assert.equal(repo.encounterUpdate.billing_status, "held");
  assert.equal(repo.encounterUpdate.encounter_status, undefined);
  assert.deepEqual(
    repo.work.map((item) => item.workqueue_type).sort(),
    ["charge_validation", "credentialing_issue", "eligibility_issue"],
  );
  assert.deepEqual(
    [...repo.resolvedWorkTypes[0]].sort(),
    ["charge_validation", "credentialing_issue", "eligibility_issue"],
  );
});

test("ready encounter routes to billing and resolves stale billing work", async () => {
  const repo = fakeRepo();
  const result = await routeEncounterToBillingWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.encounterUpdate.billing_status, "ready");
  assert.equal(repo.encounterUpdate.encounter_status, undefined);
  assert.equal(repo.work.length, 0);
  assert.deepEqual(repo.resolvedWorkTypes, [[]]);
});

test("ready encounter creates a traceable ready-for-claim charge", async () => {
  const repo = fakeRepo();
  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges.length, 1);
  assert.equal(repo.charges[0].encounter_id, "enc-1");
  assert.equal(repo.charges[0].service_line_id, "line-1");
  assert.equal(repo.charges[0].units, 1);
  assert.equal(repo.charges[0].charge_status, "ready_for_claim");
  assert.equal(repo.encounterUpdate.billing_status, "charged");
  assert.equal(repo.serviceLineUpdates[0].values.ready_for_claim, true);
});

test("billing blockers hold the captured charge instead of blocking clinical completion", async () => {
  const repo = fakeRepo({
    ...cleanContext,
    eligibilityStatus: "inactive",
    serviceLines: [{
      ...cleanContext.serviceLines[0],
      units: 2,
    }],
  });

  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges.length, 1);
  assert.equal(repo.charges[0].service_line_id, "line-1");
  assert.equal(repo.charges[0].units, 2);
  assert.equal(repo.charges[0].charge_status, "blocked");
  assert.match(String(repo.charges[0].block_reason), /Eligibility/i);
  assert.equal(repo.encounterUpdate.billing_status, "held");
  assert.equal(repo.serviceLineUpdates[0].values.ready_for_claim, false);
});

test("re-audit clears a blocked charge without creating a duplicate", async () => {
  const repo = fakeRepo(cleanContext, [{
    id: "charge-existing",
    encounter_id: "enc-1",
    service_line_id: "line-1",
    charge_status: "blocked",
    block_reason: "Eligibility is inactive.",
  }]);

  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges.length, 1);
  assert.equal(repo.charges[0].id, "charge-existing");
  assert.equal(repo.charges[0].charge_status, "ready_for_claim");
  assert.equal(repo.charges[0].block_reason, null);
  assert.equal(repo.encounterUpdate.billing_status, "charged");
});

test("self-pay encounter is billing ready without payer checks", () => {
  const result = evaluateBillingReadiness({
    ...cleanContext,
    billingType: "self_pay",
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
    encounter: { ...cleanContext.encounter, payer_id: null },
  });

  assert.equal(result.ready, true);
  assert.ok(result.checks.some((check) => check.code === "self_pay" && !check.blocking));
  assert.equal(result.checks.some((check) => check.code === "eligibility_not_active"), false);
  assert.equal(result.checks.some((check) => check.code === "provider_enrollment"), false);
});

test("self-pay encounter creates patient-responsibility charge instead of claim-ready charge", async () => {
  const repo = fakeRepo({
    ...cleanContext,
    billingType: "self_pay",
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
    encounter: { ...cleanContext.encounter, payer_id: null },
  });

  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges.length, 1);
  assert.equal(repo.charges[0].charge_status, "patient_responsibility");
  assert.equal(repo.charges[0].payer_id, null);
  assert.equal(repo.encounterUpdate.billing_status, "charged");
  assert.equal(repo.serviceLineUpdates[0].values.ready_for_claim, false);
});


test("program-funded encounter bypasses payer prerequisites and keeps missing diagnosis advisory", () => {
  const result = evaluateBillingReadiness({
    ...cleanContext,
    fundingSourceType: "government_program",
    fundingSourceSubtype: "judicial",
    billingPath: "program_invoice_voucher",
    fundingContext: { responsible_entity: "Synthetic Court Program", reference: "V-100" },
    diagnoses: [],
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
    encounter: { ...cleanContext.encounter, payer_id: null },
  });
  assert.equal(result.ready, true);
  assert.ok(result.checks.some((check) => check.code === "program_billing" && !check.blocking));
  assert.ok(result.checks.some((check) => check.code === "diagnosis_not_recorded" && check.status === "warn" && !check.blocking));
  assert.equal(result.checks.some((check) => check.code === "eligibility_not_active"), false);
  assert.equal(result.checks.some((check) => check.code === "provider_enrollment"), false);
});

test("program-funded encounter creates a program-billing charge and never marks the service line claim-ready", async () => {
  const repo = fakeRepo({
    ...cleanContext,
    fundingSourceType: "government_program",
    fundingSourceSubtype: "probation_parole",
    billingPath: "program_invoice_voucher",
    fundingContext: { responsible_entity: "Synthetic Program", reference: "VOUCHER-1" },
    eligibilityStatus: null,
    providerEnrollmentStatus: null,
    encounter: {
      ...cleanContext.encounter,
      payer_id: null,
      funding_source_type: "government_program",
      funding_source_subtype: "probation_parole",
      billing_path: "program_invoice_voucher",
      funding_context: { responsible_entity: "Synthetic Program", reference: "VOUCHER-1" },
    },
  });
  const result = await createChargeFromEncounterWorkflow(repo, "enc-1");
  assert.equal(result.ok, true);
  assert.equal(repo.charges[0].charge_status, "program_billing");
  assert.equal(repo.charges[0].payer_id, null);
  assert.equal(repo.charges[0].billing_path, "program_invoice_voucher");
  assert.equal(repo.charges[0].funding_source_type, "government_program");
  assert.equal(repo.serviceLineUpdates[0].values.ready_for_claim, false);
  assert.equal(repo.encounterUpdate.billing_status, "charged");
});
