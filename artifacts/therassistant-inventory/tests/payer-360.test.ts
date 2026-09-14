import test from "node:test";
import assert from "node:assert/strict";

import { buildPayer360View } from "../src/domains/credentialing/payer-360.ts";

test("Payer 360 resolves enrolled providers and fee schedule contract context", () => {
  const result = buildPayer360View({
    payerId: "payer-1",
    payers: [{ id: "payer-1", name: "Aetna", payer_type: "commercial" }],
    plans: [
      { id: "plan-1", payer_id: "payer-1", name: "Open Choice PPO", plan_type: "PPO" },
      { id: "plan-2", payer_id: "payer-2", name: "Other Plan" },
    ],
    providers: [{ id: "provider-1", first_name: "Samantha", last_name: "Thomas", credentials: "LCSW" }],
    enrollments: [{ id: "enrollment-1", payer_id: "payer-1", provider_id: "provider-1", enrollment_status: "approved" }],
    contracts: [{ id: "contract-1", payer_id: "payer-1", contract_name: "Aetna Colorado", status: "active" }],
    feeSchedules: [{ id: "schedule-1", payer_contract_id: "contract-1", name: "2026 Fee Schedule", status: "active" }],
    feeScheduleLines: [{ id: "line-1", fee_schedule_id: "schedule-1", cpt_code: "90837", modifier: null, rate_cents: 12500 }],
  });

  assert.equal(result.payer.name, "Aetna");
  assert.equal(result.plans.length, 1);
  assert.equal(result.enrolledProviders[0].providerName, "Samantha Thomas, LCSW");
  assert.equal(result.contracts[0].feeSchedules[0].lines[0].cpt_code, "90837");
  assert.equal(result.contracts[0].feeSchedules[0].lines[0].rate_cents, 12500);
});
