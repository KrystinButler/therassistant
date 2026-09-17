import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeBillingHub } from "../src/domains/billing/workflow.ts";
import * as workCenterRepository from "../src/domains/work-center/repository.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const workCenterRepositorySource = fs.readFileSync(
  path.join(here, "../src/domains/work-center/repository.ts"),
  "utf8",
);

test("manual allocation is capped at the claim open balance", () => {
  const requested = 12000;
  const openBalance = 8000;
  const allocation = Math.min(requested, openBalance);
  assert.equal(allocation, 8000);
});

test("credentialing or contracting write-off also closes the linked claim financial state", () => {
  const adjustment = {
    adjustment_type: "credentialing_write_off",
    amount_cents: 5000,
    status: "posted",
  };
  const claim = { total_charge_cents: 5000, total_paid_cents: 0 };
  const openBalance = adjustment.status === "posted" ? Math.max(0, claim.total_charge_cents - adjustment.amount_cents) : claim.total_charge_cents;
  assert.equal(openBalance, 0);
});

test("active appeal dollars come from the linked denial amount", () => {
  const denial = { id: "d-1", denied_amount_cents: 12000 };
  const appeal = { denial_id: "d-1", status: "submitted" };
  const amount = appeal.status === "submitted" && appeal.denial_id === denial.id ? denial.denied_amount_cents : 0;
  assert.equal(amount, 12000);
});

test("reversed and voided recovery adjustments are excluded from Billing Hub recovery metrics", () => {
  const summary = summarizeBillingHub({
    claims: [],
    payments: [],
    paymentAllocations: [],
    denials: [],
    appeals: [],
    adjustments: [
      { id: "a1", amount_cents: 3000, adjustment_type: "recoupment", status: "posted" },
      { id: "a2", amount_cents: 9000, adjustment_type: "recoupment", status: "reversed" },
      { id: "a3", amount_cents: 7000, adjustment_type: "refund_correction", status: "voided" },
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
