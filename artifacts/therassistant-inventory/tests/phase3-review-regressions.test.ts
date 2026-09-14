import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { calculateOpenBalance } from "../src/domains/ar/aging";
import * as paymentOperations from "../src/domains/payments/operations";
import * as claimWorkqueues from "../src/domains/claims/workqueues";
import { buildClaimWorkqueues } from "../src/domains/claims/workqueues";

const paymentRepositorySource = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const billingHubPageSource = readFileSync(
  new URL("../src/domains/billing/BillingHubPage.tsx", import.meta.url),
  "utf8",
);
const claimsWorkspacePageSource = readFileSync(
  new URL("../src/domains/claims/ClaimsWorkspacePage.tsx", import.meta.url),
  "utf8",
);

test("recoupment increases the reopened claim balance instead of reducing it", () => {
  const balance = (calculateOpenBalance as (...args: number[]) => number)(
    12000,
    12000,
    0,
    3000,
  );
  assert.equal(balance, 3000);
});

test("payment ownership is derived from the selected claim", () => {
  const resolvePaymentOwnership = (
    paymentOperations as Record<string, unknown>
  ).resolvePaymentOwnership as
    | ((input: {
        source: string;
        requestedClientId?: string;
        requestedPayerId?: string;
        claimClientId?: string;
        claimPayerId?: string;
      }) => { clientId: string | null; payerId: string | null })
    | undefined;

  assert.equal(typeof resolvePaymentOwnership, "function");
  if (!resolvePaymentOwnership) return;

  assert.deepEqual(
    resolvePaymentOwnership({
      source: "insurance",
      requestedClientId: "patient-a",
      requestedPayerId: "payer-a",
      claimClientId: "patient-b",
      claimPayerId: "payer-b",
    }),
    { clientId: "patient-b", payerId: "payer-b" },
  );
});

test("claim financial status follows the remaining balance", () => {
  const deriveClaimFinancialStatus = (
    paymentOperations as Record<string, unknown>
  ).deriveClaimFinancialStatus as
    | ((input: {
        chargeCents: number;
        paidCents: number;
        adjustmentCents: number;
        recoveryCents?: number;
      }) => string)
    | undefined;

  assert.equal(typeof deriveClaimFinancialStatus, "function");
  if (!deriveClaimFinancialStatus) return;

  assert.equal(
    deriveClaimFinancialStatus({
      chargeCents: 10000,
      paidCents: 10000,
      adjustmentCents: 0,
    }),
    "paid",
  );
  assert.equal(
    deriveClaimFinancialStatus({
      chargeCents: 10000,
      paidCents: 6000,
      adjustmentCents: 0,
    }),
    "partially_paid",
  );
  assert.equal(
    deriveClaimFinancialStatus({
      chargeCents: 10000,
      paidCents: 0,
      adjustmentCents: 0,
    }),
    "accepted",
  );
  assert.equal(
    deriveClaimFinancialStatus({
      chargeCents: 10000,
      paidCents: 10000,
      adjustmentCents: 0,
      recoveryCents: 3000,
    }),
    "partially_paid",
  );
});

test("manual payment resynchronizes client-side status and reversal delegates atomically to the database", () => {
  assert.match(paymentRepositorySource, /resolvePaymentOwnership/);
  assert.doesNotMatch(
    paymentRepositorySource,
    /input\.clientId\s*\|\|\s*claim\?\.client_id/,
  );
  const syncCalls = paymentRepositorySource.match(/syncClaimFinancialStatus/g) ?? [];
  assert.ok(syncCalls.length >= 2, "expected helper definition plus manual-payment synchronization call");
  assert.match(paymentRepositorySource, /demoRpc<DemoPaymentReversalResult>\("reverse_demo_payment"/);
});

test("superseded rejection responses do not keep an accepted claim in the rejection queue", () => {
  const result = buildClaimWorkqueues(
    [{ id: "c1", claim_status: "accepted" }],
    [
      { id: "r2", claim_id: "c1", response_status: "accepted", created_at: "2026-09-02T00:00:00Z" },
      { id: "r1", claim_id: "c1", response_status: "rejected", created_at: "2026-09-01T00:00:00Z" },
    ],
    [],
    [],
  );

  assert.deepEqual(result.rejections.map((row) => row.id), []);
});

test("Billing Hub loads detected contract variances instead of forcing underpayments to zero", () => {
  assert.doesNotMatch(billingHubPageSource, /variances:\s*\[\]/);
  assert.match(billingHubPageSource, /getArWorkspaceData/);
});

test("completed appeal outcomes are excluded from active appeal views", () => {
  const isActiveAppealStatus = (
    claimWorkqueues as Record<string, unknown>
  ).isActiveAppealStatus as ((status: unknown) => boolean) | undefined;

  assert.equal(typeof isActiveAppealStatus, "function");
  if (!isActiveAppealStatus) return;

  assert.equal(isActiveAppealStatus("drafting"), true);
  assert.equal(isActiveAppealStatus("submitted"), true);
  assert.equal(isActiveAppealStatus("pending"), true);
  assert.equal(isActiveAppealStatus("approved"), false);
  assert.equal(isActiveAppealStatus("partially_approved"), false);
  assert.equal(isActiveAppealStatus("denied"), false);
  assert.equal(isActiveAppealStatus("withdrawn"), false);
  assert.equal(isActiveAppealStatus("closed"), false);
  assert.match(claimsWorkspacePageSource, /isActiveAppealStatus/);
});
