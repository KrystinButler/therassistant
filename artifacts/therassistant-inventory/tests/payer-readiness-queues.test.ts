import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEligibilityQueue,
  buildAuthorizationQueue,
} from "../src/domains/payer-readiness/queues.ts";

const clients = [
  { id: "c1", first_name: "Jordan", last_name: "Ellis" },
  { id: "c2", first_name: "Taylor", last_name: "Brooks" },
];
const payers = [{ id: "p1", name: "Anthem" }];
const policies = [
  { id: "pol1", client_id: "c1", payer_id: "p1", insurance_order: "primary", status: "active", member_id: "A1", metadata: { authorization_required: true } },
  { id: "pol2", client_id: "c2", payer_id: "p1", insurance_order: "primary", status: "active", member_id: "B2", metadata: { authorization_required: true } },
];

test("eligibility queue uses the latest policy-specific result", () => {
  const rows = buildEligibilityQueue({
    clients,
    payers,
    policies,
    eligibility: [
      { id: "e1", client_id: "c1", insurance_policy_id: "pol1", eligibility_status: "inactive", service_date: "2026-09-01", created_at: "2026-09-01T10:00:00Z" },
      { id: "e2", client_id: "c1", insurance_policy_id: "pol1", eligibility_status: "active", service_date: "2026-09-20", created_at: "2026-09-13T10:00:00Z" },
    ],
  });

  const jordan = rows.find((row) => row.patientId === "c1");
  const taylor = rows.find((row) => row.patientId === "c2");
  assert.equal(jordan?.status, "active");
  assert.equal(jordan?.needsAttention, false);
  assert.equal(taylor?.status, "not_checked");
  assert.equal(taylor?.needsAttention, true);
});

test("authorization queue surfaces required coverage with no authorization", () => {
  const rows = buildAuthorizationQueue({
    clients,
    payers,
    policies,
    authorizations: [
      { id: "a1", client_id: "c1", payer_id: "p1", status: "approved", end_date: "2026-12-31" },
    ],
    units: [
      { id: "u1", authorization_id: "a1", remaining_units: 2 },
    ],
    today: "2026-09-13",
  });

  const jordan = rows.find((row) => row.patientId === "c1");
  const taylor = rows.find((row) => row.patientId === "c2");
  assert.equal(jordan?.status, "approved");
  assert.equal(jordan?.alert, "low_units");
  assert.equal(taylor?.status, "missing");
  assert.equal(taylor?.alert, "missing");
});
