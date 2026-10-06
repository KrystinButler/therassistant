import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostingWorkContext, postingWorkItemId } from "../src/domains/payments/posting-work-context.ts";
import { workRouteForWorkItem } from "../src/domains/work-center/repository.ts";

const eras = [
  { id: "e1", claim_id: "c1", era_file_id: "file1" },
  { id: "e2", claim_id: "c1", era_file_id: "file2" },
  { id: "e3", claim_id: "c2", era_file_id: "file1" },
];
test("posting routes retain the exact task ID and payment-specific routes", () => {
  assert.equal(workRouteForWorkItem("claim", "c1", "payment_posting_issue", { workItemId: "work &1" }), "/payments?tab=era&work=work%20%261");
  assert.equal(workRouteForWorkItem("era", "file1", "unmatched_era", { workItemId: "w2" }), "/payments?tab=era&work=w2");
  assert.equal(workRouteForWorkItem("payment", "pay1", "payment_posting_issue", { workItemId: "w3" }), "/payments?payment=pay1");
});
test("claim-sourced tasks show all associated remittances without substituting a task", () => {
  const task = { id: "w1", workqueue_type: "payment_posting_issue", source_object_type: "claim", source_object_id: "c1" };
  const result = resolvePostingWorkContext(task, eras);
  assert.equal(result?.workItem, task);
  assert.deepEqual(result?.eraClaims.map((row) => row.id), ["e1", "e2"]);
});
test("ERA-sourced tasks scope records to their file", () => {
  assert.deepEqual(resolvePostingWorkContext({ id: "w2", workqueue_type: "unmatched_era", source_object_type: "era", source_object_id: "file1" }, eras)?.eraClaims.map((row) => row.id), ["e1", "e3"]);
});
test("missing, unrelated, and invalid sources cannot select another exception", () => {
  assert.equal(resolvePostingWorkContext(null, eras), null);
  assert.equal(resolvePostingWorkContext({ id: "w1", workqueue_type: "contract_variance", source_object_type: "claim", source_object_id: "c1" }, eras), null);
  assert.equal(resolvePostingWorkContext({ id: "w1", workqueue_type: "payment_posting_issue", source_object_type: "claim", source_object_id: "" }, eras), null);
  assert.deepEqual(resolvePostingWorkContext({ id: "w1", workqueue_type: "payment_posting_issue", source_object_type: "claim", source_object_id: "missing" }, eras)?.eraClaims, []);
});

test("malformed posting task IDs cannot reach the UUID lookup", () => {
  for (const id of [null, undefined, "", "truncated", "e2b6b5e2-dbc0-d885-c96c", "a".repeat(36), "e2b6b5e2-dbc0-d885-c96c-5c413cd5a73z"]) {
    assert.equal(postingWorkItemId(id), null);
  }
  for (const id of ["e2b6b5e2-dbc0-d885-c96c-5c413cd5a737", "E2B6B5E2-DBC0-D885-C96C-5C413CD5A737"]) {
    assert.equal(postingWorkItemId(id), id);
  }
});
