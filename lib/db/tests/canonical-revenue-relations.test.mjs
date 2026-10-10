import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(file) {
  return readFile(new URL(`../src/schema/${file}`, import.meta.url), "utf8");
}

test("shared DB schema exposes canonical clinical and revenue lineage", async () => {
  const [clinical, encounters, payments, remittance] = await Promise.all([
    source("clinical.ts"), source("encounters.ts"), source("payments.ts"), source("remittance.ts"),
  ]);

  const expectations = [
    [clinical, 'encounterId: uuid("encounter_id")', "clinical signature encounter"],
    [clinical, 'tenantUserId: uuid("tenant_user_id")', "clinical signature tenant user"],
    [encounters, 'providerLocationId: uuid("provider_location_id")', "encounter provider location"],
    [encounters, 'tenantUserId: uuid("tenant_user_id")', "encounter tenant user"],
    [payments, 'encounterId: uuid("encounter_id")', "payment allocation encounter"],
    [payments, 'chargeId: uuid("charge_id")', "payment allocation charge"],
    [payments, 'insurancePolicyId: uuid("insurance_policy_id")', "payment allocation insurance"],
    [remittance, 'appointmentId: uuid("appointment_id")', "ledger transaction appointment"],
    [remittance, 'encounterId: uuid("encounter_id")', "ledger transaction encounter"],
    [remittance, 'chargeId: uuid("charge_id")', "ledger transaction charge"],
    [remittance, 'insurancePolicyId: uuid("insurance_policy_id")', "ledger transaction insurance"],
    [remittance, 'paymentId: uuid("payment_id")', "ledger transaction payment"],
    [remittance, 'adjustmentId: uuid("adjustment_id")', "ledger transaction adjustment"],
    [remittance, 'accountingPeriodId: uuid("accounting_period_id")', "ledger transaction accounting period"],
  ];

  for (const [text, needle, label] of expectations) {
    assert.ok(text.includes(needle), `Missing ${label}: ${needle}`);
  }
});
