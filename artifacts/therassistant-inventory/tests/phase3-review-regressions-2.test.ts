import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBillingHubSummary } from "../src/domains/billing/hub";
import * as paymentOperations from "../src/domains/payments/operations";
import * as workCenterRepository from "../src/domains/work-center/repository";

const denialRepositorySource = readFileSync(
  new URL("../src/domains/ar/denial-repository.ts", import.meta.url),
  "utf8",
);
const workCenterRepositorySource = readFileSync(
  new URL("../src/domains/work-center/repository.ts", import.meta.url),
  "utf8",
);

test("manual allocation is capped at the claim open balance", () => {
  const capAllocationToOpenBalance = (
    paymentOperations as Record<string, unknown>
  ).capAllocationToOpenBalance as
    | ((requestedCents: number, openBalanceCents: number) => number)
    | undefined;

  assert.equal(typeof capAllocationToOpenBalance, "function");
  if (!capAllocationToOpenBalance) return;

  assert.equal(capAllocationToOpenBalance(10000, 4000), 4000);
  assert.equal(capAllocationToOpenBalance(2500, 4000), 2500);
  assert.equal(capAllocationToOpenBalance(1000, 0), 0);
});

test("credentialing or contracting write-off also closes the linked claim financial state", () => {
  const writeOffSection = denialRepositorySource.split("export async function writeOffDenial")[1] ?? "";
  assert.match(writeOffSection, /tenantUpdate<DataRow>\("professional_claims"/);
  assert.match(writeOffSection, /claim_status:\s*"paid"/);
});

test("active appeal dollars come from the linked denial amount", () => {
  const summary = buildBillingHubSummary({
    charges: [],
    claims: [],
    payments: [],
    denials: [{ id: "d1", denial_status: "appealed", amount_cents: 14000 }],
    appeals: [{ id: "a1", denial_id: "d1", appeal_status: "pending" }],
    insuranceAr: [],
    patientAr: [],
    variances: [],
    recoveryItems: [],
  });

  assert.equal(summary.appeals.count, 1);
  assert.equal(summary.appeals.amountCents, 14000);
});

test("reversed and voided recovery adjustments are excluded from Billing Hub recovery metrics", () => {
  const summary = buildBillingHubSummary({
    charges: [],
    claims: [],
    payments: [],
    denials: [],
    appeals: [],
    insuranceAr: [],
    patientAr: [],
    variances: [],
    recoveryItems: [
      { id: "r1", adjustment_status: "posted", amount_cents: 3000 },
      { id: "r2", adjustment_status: "reversed", amount_cents: 2000 },
      { id: "r3", adjustment_status: "voided", amount_cents: 1000 },
    ],
  });

  assert.deepEqual(summary.recovery, { count: 1, amountCents: 3000 });
});

test("adjustment work items resolve to recovery context and route", () => {
  const sourceRouteForWorkItem = (
    workCenterRepository as Record<string, unknown>
  ).sourceRouteForWorkItem as
    | ((type: string, id: string) => string)
    | undefined;

  assert.equal(typeof sourceRouteForWorkItem, "function");
  if (sourceRouteForWorkItem) {
    assert.equal(sourceRouteForWorkItem("adjustment", "adj-1"), "/ar-denials?tab=recovery");
  }
  assert.match(workCenterRepositorySource, /tenantSelect<DataRow>\("adjustments"/);
  assert.match(workCenterRepositorySource, /adjustmentsById/);
  assert.match(workCenterRepositorySource, /type === "adjustment"/);
});
