import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/domains/payments/PaymentsPage.tsx", import.meta.url), "utf8");

test("Payments owns payment exceptions but not Denials", () => {
  assert.match(source, /Underpayments/);
  assert.match(source, /Recoupments \/ Refunds/);
  assert.match(source, /routeVarianceToWork/);
  assert.match(source, /routeRecoveryToWork/);
  assert.match(source, /UnderpaymentReviewDrawer/);
  assert.match(source, /RecoveryReviewDrawer/);
  assert.doesNotMatch(source, /label={`Denials/);
  assert.doesNotMatch(source, /function DenialsTable/);
});

test("Payments no longer links to the retired Claim Submission page", () => {
  assert.doesNotMatch(source, /href="\/claims\/submission"/);
});


test("Payments uses real 835 import rather than synthetic payer adjudication", () => {
  assert.match(source, /Import ERA \/ 835/);
  assert.match(source, /import835/);
  assert.match(source, /type="file"/);
  assert.doesNotMatch(source, /postDemoEra/);
  assert.doesNotMatch(source, /Post Paid ERA/);
  assert.doesNotMatch(source, /Demo Denied/);
  assert.doesNotMatch(source, /synthetic payer outcomes/i);
});
