import test from "node:test";
import assert from "node:assert/strict";

import {
  getClaimsTab,
  getDenialTab,
  getOperationalHome,
  getRejectionCategories,
} from "../src/domains/rcm/queue-routing";

const today = new Date("2026-09-16T12:00:00Z");

test("operational ownership routes each claim state to one canonical area", () => {
  assert.equal(getOperationalHome({ claimStatus: "ready_for_validation", hasActiveDenial: false, openBalanceCents: 10000 }), "charges");
  assert.equal(getOperationalHome({ claimStatus: "validation_failed", hasActiveDenial: false, openBalanceCents: 10000 }), "rejections");
  assert.equal(getOperationalHome({ claimStatus: "rejected", hasActiveDenial: false, openBalanceCents: 10000 }), "rejections");
  assert.equal(getOperationalHome({ claimStatus: "ready_for_batch", hasActiveDenial: false, openBalanceCents: 10000 }), "charges");
  assert.equal(getOperationalHome({ claimStatus: "submitted", hasActiveDenial: false, openBalanceCents: 10000 }), "claims");
  assert.equal(getOperationalHome({ claimStatus: "denied", hasActiveDenial: true, openBalanceCents: 10000 }), "denials");
  assert.equal(getOperationalHome({ claimStatus: "paid", hasActiveDenial: false, openBalanceCents: 0 }), "payments");
});

test("Claims tabs are mutually exclusive with deferred and no-response precedence", () => {
  assert.equal(getClaimsTab({ deferred: true, submittedAt: "2026-06-01", serviceDate: "2026-05-30", hasPayerResponse: false }, today), "deferred");
  assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-09-10", serviceDate: "2026-09-01", hasPayerResponse: false }, today), "no_response");
  assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-09-01", serviceDate: "2026-08-20", hasPayerResponse: true }, today), "0_30");
  assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-07-15", serviceDate: "2026-07-15", hasPayerResponse: true }, today), "61_90");
  assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-04-01", serviceDate: "2026-04-01", hasPayerResponse: true }, today), "120_plus");
});

test("Rejections can expose multiple unresolved correction categories", () => {
  assert.deepEqual(
    getRejectionCategories([
      "Patient is missing.",
      "Claim line CPT/HCPCS is missing.",
      "Authorization number is invalid.",
    ]),
    ["patient", "procedure_modifier", "authorization"],
  );
});

test("Denials tabs use deferred, appeal, corrected-claim, then denial-reason precedence", () => {
  assert.equal(getDenialTab({ deferred: true, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "deferred");
  assert.equal(getDenialTab({ deferred: false, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "appeals");
  assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: true, denialCategory: "coding" }), "corrected_claims");
  assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: false, denialCategory: "timely_filing" }), "timely_filing");
});
