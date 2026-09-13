import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import * as denialRules from "../src/domains/ar/denials";
import { buildBillingHubSummary } from "../src/domains/billing/hub";
import * as billingHub from "../src/domains/billing/hub";
import * as paymentOperations from "../src/domains/payments/operations";

const denialRepositorySource = readFileSync(
  new URL("../src/domains/ar/denial-repository.ts", import.meta.url),
  "utf8",
);
const billingHubPageSource = readFileSync(
  new URL("../src/domains/billing/BillingHubPage.tsx", import.meta.url),
  "utf8",
);
const paymentRepositorySource = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const demoClientSource = readFileSync(
  new URL("../src/lib/supabase-demo-client.ts", import.meta.url),
  "utf8",
);
const restrictedAllocationMigrationUrl = new URL(
  "../../../supabase/migrations/20260913_phase3_restrict_payment_allocation_columns.sql",
  import.meta.url,
);

test("denial write-off is capped at the claim remaining balance", () => {
  const capDenialWriteOffAmount = (
    denialRules as Record<string, unknown>
  ).capDenialWriteOffAmount as
    | ((denialAmountCents: number, openBalanceCents: number) => number)
    | undefined;

  assert.equal(typeof capDenialWriteOffAmount, "function");
  if (!capDenialWriteOffAmount) return;

  assert.equal(capDenialWriteOffAmount(12000, 7000), 7000);
  assert.equal(capDenialWriteOffAmount(5000, 7000), 5000);
  assert.equal(capDenialWriteOffAmount(12000, 0), 0);
  assert.match(denialRepositorySource, /payment_allocations/);
  assert.match(denialRepositorySource, /calculateOpenBalance/);
  assert.match(denialRepositorySource, /capDenialWriteOffAmount/);
});

test("claimless patient payment requires a patient owner", () => {
  const resolvePaymentOwnership = paymentOperations.resolvePaymentOwnership;
  assert.throws(
    () => resolvePaymentOwnership({ source: "patient" }),
    /patient/i,
  );
  assert.deepEqual(
    resolvePaymentOwnership({ source: "patient", requestedClientId: "patient-1" }),
    { clientId: "patient-1", payerId: null },
  );
});

test("Billing Hub counts only the unapplied portion of partially applied payments", () => {
  const summary = buildBillingHubSummary({
    charges: [],
    claims: [],
    payments: [
      { payment_status: "partially_applied", amount_cents: 10000, unappliedCents: 4000 },
      { payment_status: "unapplied", amount_cents: 2500, unappliedCents: 2500 },
    ],
    denials: [],
    appeals: [],
    insuranceAr: [],
    patientAr: [],
    variances: [],
    recoveryItems: [],
  });

  assert.deepEqual(summary.unappliedPayments, { count: 2, amountCents: 6500 });
  assert.match(billingHubPageSource, /unappliedCents/);
  assert.match(billingHubPageSource, /!row\.reversed_at/);
});

test("voided and reversed claims are not active Billing Hub A/R", () => {
  const isActiveArClaimStatus = (
    billingHub as Record<string, unknown>
  ).isActiveArClaimStatus as ((status: unknown) => boolean) | undefined;

  assert.equal(typeof isActiveArClaimStatus, "function");
  if (!isActiveArClaimStatus) return;

  assert.equal(isActiveArClaimStatus("accepted"), true);
  assert.equal(isActiveArClaimStatus("partially_paid"), true);
  assert.equal(isActiveArClaimStatus("patient_responsibility"), true);
  assert.equal(isActiveArClaimStatus("voided"), false);
  assert.equal(isActiveArClaimStatus("reversed"), false);
  assert.match(billingHubPageSource, /isActiveArClaimStatus/);
});

test("anonymous payment allocation updates are limited to reversed_at", () => {
  assert.equal(existsSync(restrictedAllocationMigrationUrl), true);
  if (!existsSync(restrictedAllocationMigrationUrl)) return;

  const sql = readFileSync(restrictedAllocationMigrationUrl, "utf8");
  assert.match(sql, /revoke\s+update\s+on\s+table\s+public\.payment_allocations\s+from\s+anon/i);
  assert.match(sql, /grant\s+update\s*\(\s*reversed_at\s*\)\s+on\s+table\s+public\.payment_allocations\s+to\s+anon/i);
  assert.doesNotMatch(sql, /grant\s+update\s+on\s+table\s+public\.payment_allocations\s+to\s+anon/i);
  assert.match(demoClientSource, /demoUpdateExact/);
  assert.match(paymentRepositorySource, /demoUpdateExact<DataRow>\("payment_allocations"/);
});
