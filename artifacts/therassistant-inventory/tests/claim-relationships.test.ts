import test from "node:test";
import assert from "node:assert/strict";

import { buildClaim360Relationships } from "../src/domains/claims/relationships.ts";

test("Claim 360 includes batch submissions and denial-linked work", () => {
  const result = buildClaim360Relationships({
    claimId: "claim-1",
    batchItems: [
      { id: "item-1", batch_id: "batch-1", claim_id: "claim-1" },
      { id: "item-2", batch_id: "batch-2", claim_id: "claim-2" },
    ],
    submissions: [
      { id: "submission-batch", batch_id: "batch-1", claim_id: null },
      { id: "submission-direct", batch_id: null, claim_id: "claim-1" },
      { id: "submission-other", batch_id: "batch-2", claim_id: null },
    ],
    denials: [{ id: "denial-1", claim_id: "claim-1" }],
    workItems: [
      { id: "work-claim", source_object_type: "claim", source_object_id: "claim-1" },
      { id: "work-denial", source_object_type: "denial", source_object_id: "denial-1" },
      { id: "work-other", source_object_type: "claim", source_object_id: "claim-2" },
    ],
  });

  assert.deepEqual(result.submissions.map((row) => row.id).sort(), ["submission-batch", "submission-direct"]);
  assert.deepEqual(result.workItems.map((row) => row.id).sort(), ["work-claim", "work-denial"]);
});
