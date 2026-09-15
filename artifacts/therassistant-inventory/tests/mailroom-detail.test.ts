import test from "node:test";
import assert from "node:assert/strict";

import { buildMailroomAggregates } from "../src/domains/mailroom/repository.ts";

test("Correspondence 360 aggregate includes active and completed correspondence work", () => {
  const rows = buildMailroomAggregates({
    mailroomItems: [{
      id: "mail-1",
      tenant_id: "tenant-1",
      subject: "Records request",
      correspondence_type: "medical_record_request",
      received_date: "2026-09-14",
      status: "action_required",
      due_date: null,
    }],
    clients: [], providers: [], payers: [], claims: [], authorizations: [], appeals: [], documents: [], statusHistory: [], assignees: [],
    workItems: [
      { id: "work-old", source_object_type: "mailroom_item", source_object_id: "mail-1", workqueue_type: "correspondence", workqueue_status: "completed", created_at: "2026-09-13T10:00:00Z" },
      { id: "work-current", source_object_type: "mailroom_item", source_object_id: "mail-1", workqueue_type: "correspondence", workqueue_status: "open", created_at: "2026-09-14T10:00:00Z" },
    ],
  });

  assert.deepEqual(rows[0].correspondenceWork.map((item) => item.id), ["work-current", "work-old"]);
  assert.equal(rows[0].activeWork?.id, "work-current");
});
