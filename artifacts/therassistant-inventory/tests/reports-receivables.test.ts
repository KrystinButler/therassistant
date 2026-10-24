import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPayerReceivable } from "../src/domains/rcm/receivables.ts";

test("never includes an unsubmitted ready or batched claim in payer A/R", () => {
  for (const status of ["ready_for_validation", "validation_failed", "corrected", "ready_for_batch", "batched"]) {
    assert.equal(isPayerReceivable({ id: "claim-1", claim_status: status }), false, status);
  }
});

test("prior transmission evidence preserves payer A/R during corrections and rebatching", () => {
  assert.equal(isPayerReceivable({ id: "claim-1", claim_status: "batched" }, new Set(["claim-1"])), true);
  assert.equal(isPayerReceivable({ id: "claim-2", claim_status: "corrected", submitted_at: "2026-10-01T12:00:00Z" }), true);
  assert.equal(isPayerReceivable({ id: "claim-3", claim_status: "accepted" }), true);
  assert.equal(isPayerReceivable({ id: "claim-4", claim_status: "voided", submitted_at: "2026-10-01T12:00:00Z" }), false);
});

test("reports display pre-submission balances apart from documented payer receivables", () => {
  const src = readFileSync(new URL("../src/pages/ReportsPage.tsx", import.meta.url), "utf8");
  assert.match(src, /Unsubmitted Claim Balance/);
  assert.match(src, /Payer A\/R/);
  assert.match(src, /isPayerReceivable\(claim, submittedClaimIds\)/);
  assert.match(src, /tenantSelect\("claim_submissions"\)/);
  assert.match(src, /tenantSelect\("claim_status_history"/);
  assert.match(src, /unsubmittedBalance/);
});
