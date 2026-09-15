import test from "node:test";
import assert from "node:assert/strict";

import {
  addCorrespondenceDocumentWithDependencies,
  buildMailroomAggregates,
  documentTypeForCorrespondence,
  findCorrespondenceDetail,
} from "../src/domains/mailroom/repository.ts";

const today = new Date("2026-09-14T12:00:00Z");

const input = {
  mailroomItems: [
    {
      id: "mail-1",
      tenant_id: "tenant-1",
      payer_id: "payer-1",
      client_id: "client-1",
      claim_id: "claim-1",
      provider_id: "provider-1",
      authorization_id: "auth-1",
      appeal_id: "appeal-1",
      document_id: "doc-1",
      assigned_user_id: "user-1",
      subject: "Medical records request",
      correspondence_type: "medical_record_request",
      received_date: "2026-09-12",
      due_date: "2026-09-18",
      status: "action_required",
      notes: "Respond through payer portal.",
    },
    {
      id: "mail-2",
      tenant_id: "tenant-1",
      payer_id: "missing-payer",
      client_id: "missing-client",
      claim_id: "missing-claim",
      provider_id: "missing-provider",
      authorization_id: null,
      appeal_id: null,
      document_id: "missing-document",
      assigned_user_id: "missing-user",
      subject: "Unmatched correspondence",
      correspondence_type: "general_correspondence",
      received_date: "2026-09-13",
      due_date: null,
      status: "new",
      notes: null,
    },
  ],
  clients: [{ id: "client-1", first_name: "Jordan", last_name: "Ellis" }],
  providers: [{ id: "provider-1", first_name: "Samantha", last_name: "Thomas", credentials: "LCSW" }],
  payers: [{ id: "payer-1", name: "Aetna" }],
  claims: [{ id: "claim-1", client_id: "client-1", payer_id: "payer-1", patient_control_number: "DEMO-001", payer_claim_number: "AETNA-42" }],
  authorizations: [{ id: "auth-1", client_id: "client-1", payer_id: "payer-1", authorization_number: "AUTH-9", status: "approved" }],
  appeals: [{ id: "appeal-1", claim_id: "claim-1", appeal_level: "first", appeal_status: "submitted" }],
  documents: [{ id: "doc-1", file_name: "records-request.pdf", document_type: "payer_correspondence", document_status: "uploaded", storage_path: "demo/tenant-1/mailroom/mail-1/records-request.pdf" }],
  statusHistory: [
    { id: "history-2", target_type: "mailroom_item", target_id: "mail-1", old_status: "new", new_status: "action_required", reason: "Deadline requires follow-up", created_at: "2026-09-12T10:05:00Z" },
    { id: "history-1", target_type: "mailroom_item", target_id: "mail-1", old_status: null, new_status: "new", reason: null, created_at: "2026-09-12T10:00:00Z" },
  ],
  workItems: [
    { id: "work-old", source_object_type: "mailroom_item", source_object_id: "mail-1", workqueue_type: "correspondence", workqueue_status: "completed", priority: "normal", due_date: "2026-09-15", created_at: "2026-09-11T10:00:00Z" },
    { id: "work-active", source_object_type: "mailroom_item", source_object_id: "mail-1", workqueue_type: "correspondence", workqueue_status: "open", priority: "high", due_date: "2026-09-18", created_at: "2026-09-12T10:05:00Z" },
  ],
  assignees: [{ user_id: "user-1", display_label: "Alex Morgan" }],
  today,
};

test("Mailroom aggregate resolves operational context without exposing IDs as labels", () => {
  const rows = buildMailroomAggregates(input);
  const row = rows.find((item) => item.id === "mail-1");
  assert.ok(row);
  assert.equal(row.patientName, "Jordan Ellis");
  assert.equal(row.providerName, "Samantha Thomas, LCSW");
  assert.equal(row.payerName, "Aetna");
  assert.equal(row.claimNumber, "DEMO-001");
  assert.equal(row.payerClaimNumber, "AETNA-42");
  assert.equal(row.authorizationNumber, "AUTH-9");
  assert.equal(row.appealLabel, "First appeal · submitted");
  assert.equal(row.assigneeName, "Alex Morgan");
  assert.equal(row.dueState, "due_soon");
  assert.equal(row.activeWork?.id, "work-active");
  assert.equal(row.document?.file_name, "records-request.pdf");
  assert.deepEqual(row.statusHistory.map((history) => history.id), ["history-1", "history-2"]);
  assert.notEqual(row.patientName, row.client_id);
  assert.notEqual(row.providerName, row.provider_id);
  assert.notEqual(row.payerName, row.payer_id);
});

test("Mailroom aggregate degrades missing linked records to explicit readable fallbacks", () => {
  const rows = buildMailroomAggregates(input);
  const row = rows.find((item) => item.id === "mail-2");
  assert.ok(row);
  assert.equal(row.patientName, "Patient record unavailable");
  assert.equal(row.providerName, "Provider record unavailable");
  assert.equal(row.payerName, "Payer record unavailable");
  assert.equal(row.claimNumber, "Claim record unavailable");
  assert.equal(row.assigneeName, "Assignee unavailable");
  assert.equal(row.documentMissing, true);
  assert.equal(row.dueState, "none");
});

test("correspondence detail lookup returns the enriched item or null", () => {
  const rows = buildMailroomAggregates(input);
  assert.equal(findCorrespondenceDetail(rows, "mail-1")?.subject, "Medical records request");
  assert.equal(findCorrespondenceDetail(rows, "does-not-exist"), null);
});

test("correspondence type maps to an existing document enum value", () => {
  assert.equal(documentTypeForCorrespondence("eob"), "eob");
  assert.equal(documentTypeForCorrespondence("appeal"), "appeal_letter");
  assert.equal(documentTypeForCorrespondence("reconsideration"), "appeal_letter");
  assert.equal(documentTypeForCorrespondence("prior_authorization_notice"), "authorization_letter");
  assert.equal(documentTypeForCorrespondence("refund_request"), "payer_correspondence");
});

const correspondence = {
  id: "mail-1",
  tenant_id: "tenant-1",
  subject: "Appeal response",
  correspondence_type: "appeal",
  received_date: "2026-09-14",
  status: "reviewed" as const,
  client_id: "client-1",
  claim_id: "claim-1",
  authorization_id: null,
  appeal_id: "appeal-1",
};

test("document orchestration deletes the uploaded object when metadata creation fails", async () => {
  const deleted: string[] = [];
  const file = new File(["pdf"], "appeal response.pdf", { type: "application/pdf" });

  await assert.rejects(
    () => addCorrespondenceDocumentWithDependencies(correspondence, file, {
      getTenantId: async () => "tenant-1",
      uploadMailroomFile: async () => ({ path: "demo/tenant-1/mailroom/mail-1/appeal-response.pdf" }),
      insertDocument: async () => { throw new Error("metadata failed"); },
      linkDocument: async () => { throw new Error("should not link"); },
      deleteObject: async (path) => { deleted.push(path); },
    }),
    /metadata failed/i,
  );

  assert.deepEqual(deleted, ["demo/tenant-1/mailroom/mail-1/appeal-response.pdf"]);
});

test("document orchestration preserves valid metadata when Mailroom linking fails", async () => {
  const deleted: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const file = new File(["pdf"], "appeal-response.pdf", { type: "application/pdf" });

  await assert.rejects(
    () => addCorrespondenceDocumentWithDependencies(correspondence, file, {
      getTenantId: async () => "tenant-1",
      uploadMailroomFile: async () => ({ path: "demo/tenant-1/mailroom/mail-1/appeal-response.pdf" }),
      insertDocument: async (values) => {
        inserted.push(values);
        return { id: "doc-new", ...values };
      },
      linkDocument: async () => { throw new Error("link failed"); },
      deleteObject: async (path) => { deleted.push(path); },
    }),
    /document was saved.*link/i,
  );

  assert.equal(inserted[0].document_type, "appeal_letter");
  assert.equal(inserted[0].document_status, "uploaded");
  assert.equal(inserted[0].client_id, "client-1");
  assert.equal(inserted[0].claim_id, "claim-1");
  assert.equal(inserted[0].appeal_id, "appeal-1");
  assert.deepEqual(deleted, []);
});
