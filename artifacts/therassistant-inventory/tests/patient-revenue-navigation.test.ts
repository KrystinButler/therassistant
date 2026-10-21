import test from "node:test";
import assert from "node:assert/strict";

import { patientRevenueTarget } from "../src/domains/patients/revenue-navigation";

test("patient chart opens the specific payment, denial or appeal in its working queue", () => {
  assert.equal(patientRevenueTarget("payment", "payment-1"), "/payments?payment=payment-1");
  assert.equal(patientRevenueTarget("denial", "denial-2"), "/denials?denial=denial-2");
  assert.equal(patientRevenueTarget("appeal", "appeal-3"), "/denials?appeal=appeal-3");
  assert.equal(patientRevenueTarget("payment", "id with spaces"), "/payments?payment=id%20with%20spaces");
  assert.throws(() => patientRevenueTarget("payment", ""), /record/i);
});
