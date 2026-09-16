import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const claimsPage = source("../src/domains/claims/ClaimsPage.tsx");
const rejectionsPage = source("../src/domains/claims/RejectionsPage.tsx");
const rejectionDrawer = source("../src/domains/claims/rejection-work-drawer.tsx");
const denialsPage = source("../src/domains/ar/DenialsPage.tsx");
const denialDrawer = source("../src/domains/ar/denial-work-drawer.tsx");
const paymentsPage = source("../src/domains/payments/PaymentsPage.tsx");
const paymentDrawers = source("../src/domains/payments/payment-work-drawers.tsx");
const paymentAllocation = source("../src/domains/payments/payment-allocation.ts");

test("active Claims workqueue opens the shared claim drawer with queue navigation", () => {
  assert.match(claimsPage, /import \{ ClaimWorkDrawer/);
  assert.match(claimsPage, /activeClaimId/);
  assert.match(claimsPage, /<ClaimWorkDrawer/);
  assert.match(claimsPage, /queuePosition=/);
  assert.match(claimsPage, /onPrevious=/);
  assert.match(claimsPage, /onNext=/);
});

test("Rejections use a correction-focused drawer instead of the generic claim workspace", () => {
  assert.match(rejectionsPage, /import \{ RejectionWorkDrawer/);
  assert.match(rejectionsPage, /<RejectionWorkDrawer/);
  assert.doesNotMatch(rejectionsPage, /<ClaimWorkDrawer/);
  assert.match(rejectionDrawer, /Rejection reason/);
  assert.match(rejectionDrawer, /Current value/);
  assert.match(rejectionDrawer, /Corrected value/);
  assert.match(rejectionDrawer, /Revalidate/);
  assert.match(rejectionDrawer, /Resubmit Claim/);
});

test("Denials drawer supports correction and structured follow-up", () => {
  assert.match(denialsPage, /DenialWorkDrawer/);
  assert.match(denialDrawer, /Correct Claim/);
  assert.match(denialDrawer, /Payer reference number/);
  assert.match(denialDrawer, /Next follow-up date/);
  assert.match(denialDrawer, /Save Follow-Up/);
  assert.match(denialDrawer, /Allowed amount/);
  assert.match(denialDrawer, /Paid amount/);
});

test("Payments allow unapplied money to be allocated to an existing claim", () => {
  assert.match(paymentsPage, /AllocatePaymentDrawer/);
  assert.match(paymentsPage, /allocateExistingPayment/);
  assert.match(paymentDrawers, /Apply Payment/);
  assert.match(paymentAllocation, /payment_allocations/);
  assert.match(paymentAllocation, /partially_applied/);
  assert.match(paymentAllocation, /applied/);
});

test("Claims, Rejections, Denials, and Payments expose queue navigation in their work drawers", () => {
  assert.match(claimsPage, /queuePosition=/);
  assert.match(rejectionsPage, /queuePosition=/);
  assert.match(denialsPage, /queuePosition=/);
  assert.match(paymentsPage, /queuePosition=/);
});
