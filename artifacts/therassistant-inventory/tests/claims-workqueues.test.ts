import test from "node:test";
import assert from "node:assert/strict";

import { buildClaimWorkqueues, canBulkClaimAction } from "../src/domains/claims/workqueues";

test("rejected claims are isolated in rejection workqueue", () => {
  const result = buildClaimWorkqueues(
    [
      { id: "c1", claim_status: "rejected" },
      { id: "c2", claim_status: "denied" },
      { id: "c3", claim_status: "ready_for_validation" },
    ],
    [],
    [{ id: "d1", claim_id: "c2", denial_status: "new" }],
    [],
  );

  assert.deepEqual(result.rejections.map((row) => row.id), ["c1"]);
  assert.deepEqual(result.denials.map((row) => row.id), ["c2"]);
  assert.deepEqual(result.validation.map((row) => row.id), ["c3"]);
});

test("clearinghouse rejection responses route claim to rejection queue", () => {
  const result = buildClaimWorkqueues(
    [{ id: "c1", claim_status: "submitted" }],
    [{ id: "r1", claim_id: "c1", response_status: "rejected" }],
    [],
    [],
  );
  assert.deepEqual(result.rejections.map((row) => row.id), ["c1"]);
});

test("bulk actions allow workflow setup but forbid financial adjudication", () => {
  assert.equal(canBulkClaimAction("validate"), true);
  assert.equal(canBulkClaimAction("create_follow_up"), true);
  assert.equal(canBulkClaimAction("retry_rejected"), true);
  assert.equal(canBulkClaimAction("mark_paid"), false);
  assert.equal(canBulkClaimAction("resolve_denial"), false);
});
