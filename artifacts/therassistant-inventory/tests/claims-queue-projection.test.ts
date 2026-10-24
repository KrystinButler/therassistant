import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { projectClaimQueueRows } from "../src/domains/claims/claim-queue-projection.ts";
import type { ClaimsWorkspaceRow } from "../src/domains/claims/workspace-repository.ts";

const claim = (id: string, status: string, submittedAt: string | null = null) =>
  ({ id, claim_status: status, submitted_at: submittedAt, clearinghouseStatus: "—", payer_claim_number: null } as unknown as ClaimsWorkspaceRow);

test("batched but unsubmitted claims remain distinguishable from payer follow-up", () => {
  const rows = projectClaimQueueRows({ claims: [claim("batched", "batched")], responses: [], denials: [], workItems: [], history: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].claim_status, "batched");
  assert.equal(rows[0].submittedAt, null);
  assert.equal(rows[0].hasPayerResponse, false);
  assert.equal(rows[0].hasActiveDenial, false);
});

test("newest current response, actual defer, and active denial are projected", () => {
  const rows = projectClaimQueueRows({
    claims: [claim("active", "submitted", "2026-10-10T10:00:00Z")],
    responses: [
      { claim_id: "active", response_status: "accepted", created_at: "2026-10-11T12:00:00Z" },
      { claim_id: "active", response_status: "rejected", created_at: "2026-10-02T10:00:00Z" },
    ],
    denials: [{ claim_id: "active", denial_status: "open" }, { claim_id: "active", denial_status: "resolved" }],
    workItems: [{ source_object_id: "active", workqueue_type: "claim_followup", workqueue_status: "pending" }],
    history: [],
  });
  assert.equal(rows[0].clearinghouseStatus, "accepted");
  assert.equal(rows[0].hasPayerResponse, true);
  assert.equal(rows[0].deferred, true);
  assert.equal(rows[0].hasActiveDenial, true);
});

test("stale response is not reused after resubmission; history can recover submitted date", () => {
  const rows = projectClaimQueueRows({
    claims: [claim("resubmitted", "submitted", "2026-10-10T10:00:00Z"), claim("legacy", "accepted")],
    responses: [{ claim_id: "resubmitted", response_status: "rejected", created_at: "2026-10-09T10:00:00Z" }],
    denials: [{ claim_id: "legacy", denial_status: "resolved_writeoff" }],
    workItems: [{ source_object_id: "legacy", workqueue_type: "claim_followup", workqueue_status: "completed" }],
    history: [{ claim_id: "legacy", new_status: "submitted", created_at: "2026-10-01T09:00:00Z" }],
  });
  assert.equal(rows[0].hasPayerResponse, false);
  assert.equal(rows[0].clearinghouseStatus, "—");
  assert.equal(rows[1].submittedAt, "2026-10-01T09:00:00Z");
  assert.equal(rows[1].deferred, false);
  assert.equal(rows[1].hasActiveDenial, false);
});

test("queue loader uses a shared history lookup, not one query per claim", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const loader = readFileSync(join(here, "../src/domains/claims/claims-queue-repository.ts"), "utf8");
  assert.match(loader, /projectClaimQueueRows/);
  assert.doesNotMatch(loader, /getClaimWorkData/);
  assert.doesNotMatch(loader, /Promise\.all\(data\.claims\.map/);
});

test("funding editor is scoped to readiness tabs and navigation asks before discarding edits", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, "../src/domains/billing/BillingQueuePage.tsx"), "utf8");
  assert.match(page, /Leave Billing Responsibility\? Unsaved edits will be discarded/);
  assert.match(page, /\["ready", "blocked"\]\.includes\(tab\) && fundingEncounterId/);
  assert.match(page, /changeTab\("batches"\)/);
});
