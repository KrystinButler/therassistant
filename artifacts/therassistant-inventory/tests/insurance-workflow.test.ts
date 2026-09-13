import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInsuranceValues,
  planPrimaryInsuranceUpdates,
  terminationValues,
} from "../src/domains/insurance/workflow.ts";

test("insurance values require payer and member ID", () => {
  assert.throws(() => buildInsuranceValues({ payerId: "", memberId: "MEM1" }), /payer/i);
  assert.throws(() => buildInsuranceValues({ payerId: "payer-1", memberId: "" }), /member ID/i);
});

test("making a policy primary demotes the existing primary", () => {
  const updates = planPrimaryInsuranceUpdates(
    [
      { id: "policy-1", insurance_order: "primary", status: "active" },
      { id: "policy-2", insurance_order: "secondary", status: "active" },
    ],
    "policy-2",
  );

  assert.deepEqual(updates, [
    { id: "policy-1", insurance_order: "secondary" },
    { id: "policy-2", insurance_order: "primary" },
  ]);
});

test("terminating insurance sets status and termination date", () => {
  assert.deepEqual(terminationValues("2026-09-30"), {
    status: "terminated",
    termination_date: "2026-09-30",
  });
});
