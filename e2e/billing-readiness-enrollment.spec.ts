import { expect, test } from "@playwright/test";

import { evaluateBillingReadiness } from "../artifacts/therassistant-inventory/src/domains/readiness/evaluate-billing-readiness";

function completeInsuranceInput(providerEnrollmentStatus: string | null) {
  return {
    encounter: {
      id: "encounter-test",
      provider_id: "provider-test",
      payer_id: "payer-test",
      funding_source_type: "insurance",
      billing_path: "insurance_claim",
      service_type: "office_visit",
    },
    note: { note_status: "signed" },
    diagnoses: [{ diagnosis_code: "F41.1" }],
    serviceLines: [{
      cpt_hcpcs_code: "99213",
      units: 1,
      charge_amount_cents: 10000,
      place_of_service_code: "11",
    }],
    billingType: "insurance",
    fundingSourceType: "insurance",
    billingPath: "insurance_claim",
    fundingContext: {},
    eligibilityStatus: "active",
    providerEnrollmentStatus,
    provider: { id: "provider-test", individual_npi: "1234567890", credentials: "MD" },
    documentedPsychotherapyMinutes: null,
    appointment: null,
    payerId: "payer-test",
    payerPlanId: null,
    payerBillingRules: [],
    serviceDate: "2026-10-06",
  };
}

test("provider-payer enrollment status is advisory and does not hold billing", () => {
  const result = evaluateBillingReadiness(completeInsuranceInput("pending"));
  const enrollment = result.checks.find((check) => check.code === "provider_enrollment");

  expect(enrollment).toBeDefined();
  expect(enrollment?.status).toBe("warn");
  expect(enrollment?.blocking).toBe(false);
  expect(result.ready).toBe(true);
});

test("true claim prerequisites still hold billing", () => {
  const input = completeInsuranceInput("pending");
  input.note = { note_status: "draft" };
  const result = evaluateBillingReadiness(input);

  expect(result.checks.find((check) => check.code === "provider_enrollment")?.blocking).toBe(false);
  expect(result.checks.find((check) => check.code === "note_unsigned")?.blocking).toBe(true);
  expect(result.ready).toBe(false);
});
