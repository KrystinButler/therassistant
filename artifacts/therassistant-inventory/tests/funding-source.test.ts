import test from "node:test";
import assert from "node:assert/strict";

import {
  billingPathForFundingSource,
  legacyFundingSourceType,
  resolveEncounterFunding,
} from "../src/domains/billing/funding-source";

test("funding source maps to a single explicit billing path", () => {
  assert.equal(billingPathForFundingSource("insurance"), "insurance_claim");
  assert.equal(billingPathForFundingSource("government_program"), "program_invoice_voucher");
  assert.equal(billingPathForFundingSource("private_pay"), "private_pay");
});

test("legacy patient billing type remains a safe fallback for existing encounters", () => {
  assert.equal(legacyFundingSourceType("self_pay"), "private_pay");
  assert.equal(legacyFundingSourceType("insurance"), "insurance");
  assert.equal(resolveEncounterFunding({}, "self_pay").billingPath, "private_pay");
  assert.equal(resolveEncounterFunding({}, "insurance").billingPath, "insurance_claim");
});

test("stored encounter funding wins but a conflicting stored path is normalized", () => {
  const funding = resolveEncounterFunding({
    funding_source_type: "government_program",
    funding_source_subtype: "judicial",
    billing_path: "insurance_claim",
    funding_context: { reference: "SYNTHETIC-VOUCHER" },
  }, "insurance");
  assert.equal(funding.sourceType, "government_program");
  assert.equal(funding.sourceSubtype, "judicial");
  assert.equal(funding.billingPath, "program_invoice_voucher");
  assert.equal(funding.context.reference, "SYNTHETIC-VOUCHER");
});
