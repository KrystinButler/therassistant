import test from "node:test";
import assert from "node:assert/strict";

import {
  availableCorrespondenceActions,
  buildCorrespondenceHistory,
  buildCorrespondenceWorkItem,
  correspondenceDueState,
  correspondencePriority,
  filterAndSortMailroomItems,
  isCorrespondenceTransitionAllowed,
} from "../src/domains/mailroom/workflow.ts";

const today = new Date("2026-09-14T12:00:00Z");

test("correspondence exposes only the approved actions for each status", () => {
  assert.deepEqual(
    availableCorrespondenceActions("new").map((action) => action.action),
    ["review", "require_action", "close"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("reviewed").map((action) => action.action),
    ["require_action", "close"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("action_required").map((action) => action.action),
    ["start", "pend", "resolve"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("in_progress").map((action) => action.action),
    ["pend", "resolve"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("pending").map((action) => action.action),
    ["start", "resolve"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("resolved").map((action) => action.action),
    ["close", "reopen"],
  );
  assert.deepEqual(
    availableCorrespondenceActions("closed").map((action) => action.action),
    ["reopen"],
  );
});

test("correspondence rejects transitions outside the approved matrix", () => {
  assert.equal(isCorrespondenceTransitionAllowed("new", "resolved"), false);
  assert.equal(isCorrespondenceTransitionAllowed("reviewed", "in_progress"), false);
  assert.equal(isCorrespondenceTransitionAllowed("closed", "closed"), false);
  assert.equal(isCorrespondenceTransitionAllowed("pending", "in_progress"), true);
  assert.equal(isCorrespondenceTransitionAllowed("resolved", "action_required"), true);
});

test("due-state calculation is deterministic and uses a seven-day due-soon window", () => {
  assert.equal(correspondenceDueState(null, today), "none");
  assert.equal(correspondenceDueState("2026-10-01", today), "current");
  assert.equal(correspondenceDueState("2026-09-21", today), "due_soon");
  assert.equal(correspondenceDueState("2026-09-14", today), "due_soon");
  assert.equal(correspondenceDueState("2026-09-13", today), "overdue");
});

test("action-required priority follows correspondence due urgency", () => {
  assert.equal(correspondencePriority("2026-09-13", today), "urgent");
  assert.equal(correspondencePriority("2026-09-18", today), "high");
  assert.equal(correspondencePriority("2026-10-01", today), "normal");
  assert.equal(correspondencePriority(null, today), "normal");
});

test("correspondence work item is mailroom-scoped and inherits due urgency", () => {
  assert.deepEqual(
    buildCorrespondenceWorkItem({
      tenantId: "tenant-1",
      mailroomItemId: "mail-1",
      subject: "Medical records request",
      correspondenceType: "medical_record_request",
      dueDate: "2026-09-18",
      today,
    }),
    {
      tenant_id: "tenant-1",
      workqueue_type: "correspondence",
      workqueue_status: "open",
      priority: "high",
      source_object_type: "mailroom_item",
      source_object_id: "mail-1",
      title: "Medical records request",
      description: "medical record request correspondence requires follow-up.",
      due_date: "2026-09-18",
    },
  );
});

test("status history preserves old and new correspondence state", () => {
  assert.deepEqual(
    buildCorrespondenceHistory({
      tenantId: "tenant-1",
      mailroomItemId: "mail-1",
      oldStatus: "new",
      newStatus: "action_required",
      reason: "Records must be sent by payer deadline.",
    }),
    {
      tenant_id: "tenant-1",
      target_type: "mailroom_item",
      target_id: "mail-1",
      old_status: "new",
      new_status: "action_required",
      reason: "Records must be sent by payer deadline.",
    },
  );
});

const inboxRows = [
  {
    id: "mail-1",
    subject: "Medical records request",
    correspondenceType: "medical_record_request",
    payerName: "Aetna",
    patientName: "Jordan Ellis",
    claimNumber: "TA-100",
    providerName: "Taylor Reed",
    assigneeName: "Alex Morgan",
    assignedUserId: "user-1",
    status: "action_required",
    receivedDate: "2026-09-12",
    dueDate: "2026-09-16",
  },
  {
    id: "mail-2",
    subject: "Credentialing approval",
    correspondenceType: "credentialing_letter",
    payerName: "Cigna",
    patientName: "—",
    claimNumber: "—",
    providerName: "Samantha Thomas",
    assigneeName: "—",
    assignedUserId: null,
    status: "reviewed",
    receivedDate: "2026-09-14",
    dueDate: null,
  },
  {
    id: "mail-3",
    subject: "Recoupment notice",
    correspondenceType: "recoupment_notice",
    payerName: "Aetna",
    patientName: "Morgan Reed",
    claimNumber: "TA-200",
    providerName: "Taylor Reed",
    assigneeName: "Alex Morgan",
    assignedUserId: "user-1",
    status: "pending",
    receivedDate: "2026-09-10",
    dueDate: "2026-09-13",
  },
];

test("Mailroom filtering searches human-readable context and filters operational fields", () => {
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { search: "Jordan", today }).map((row) => row.id),
    ["mail-1"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { status: "reviewed", today }).map((row) => row.id),
    ["mail-2"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { correspondenceType: "recoupment_notice", today }).map((row) => row.id),
    ["mail-3"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { payerName: "Aetna", assignedUserId: "user-1", today }).map((row) => row.id),
    ["mail-1", "mail-3"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { dueState: "overdue", today }).map((row) => row.id),
    ["mail-3"],
  );
});

test("Mailroom sorting supports newest, oldest, and due-date order", () => {
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { sort: "newest", today }).map((row) => row.id),
    ["mail-2", "mail-1", "mail-3"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { sort: "oldest", today }).map((row) => row.id),
    ["mail-3", "mail-1", "mail-2"],
  );
  assert.deepEqual(
    filterAndSortMailroomItems(inboxRows, { sort: "due", today }).map((row) => row.id),
    ["mail-3", "mail-1", "mail-2"],
  );
});
