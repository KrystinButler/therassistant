import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMailroomWorkContext,
  sourceRouteForWorkItem,
  workRouteForWorkItem,
} from "../src/domains/work-center/repository.ts";
import {
  changePriority,
  completeWork,
  pendWork,
  reopenWork,
  startWork,
  type WorkCenterRepository,
} from "../src/domains/work-center/workflow.ts";

type Row = Record<string, any> & { id: string };

function makeRepo(initial: Row = {
  id: "work-1",
  workqueue_status: "open",
  priority: "normal",
  completed_at: null,
  completed_by: null,
}) {
  let item = { ...initial };
  const history: Row[] = [];
  const repo: WorkCenterRepository = {
    async getWorkItem(id) { return id === item.id ? item : null; },
    async updateWorkItem(id, values) {
      if (id !== item.id) throw new Error("Work item not found");
      item = { ...item, ...values };
      return item;
    },
    async insertHistory(values) {
      const row = { id: `history-${history.length + 1}`, ...values };
      history.push(row);
      return row;
    },
  };
  return { repo, get item() { return item; }, history };
}

test("starting work changes status and records history", async () => {
  const state = makeRepo();
  const result = await startWork(state.repo, "work-1");
  assert.equal(result.ok, true);
  assert.equal(state.item.workqueue_status, "in_progress");
  assert.equal(state.history[0].old_status, "open");
  assert.equal(state.history[0].new_status, "in_progress");
});

test("pending work records reason in history", async () => {
  const state = makeRepo({ id: "work-1", workqueue_status: "in_progress", priority: "high" });
  const result = await pendWork(state.repo, "work-1", "Waiting for payer response.");
  assert.equal(result.ok, true);
  assert.equal(state.item.workqueue_status, "pending");
  assert.match(String(state.history[0].note), /payer response/i);
});

test("priority change records old and new priority", async () => {
  const state = makeRepo();
  const result = await changePriority(state.repo, "work-1", "urgent");
  assert.equal(result.ok, true);
  assert.equal(state.item.priority, "urgent");
  assert.equal(state.history[0].old_priority, "normal");
  assert.equal(state.history[0].new_priority, "urgent");
});

test("complete and reopen preserve auditable history", async () => {
  const state = makeRepo({ id: "work-1", workqueue_status: "in_progress", priority: "normal" });
  const completed = await completeWork(state.repo, "work-1", "Resolved after corrected claim.");
  assert.equal(completed.ok, true);
  assert.equal(state.item.workqueue_status, "completed");
  assert.ok(state.item.completed_at);
  assert.equal(state.history.at(-1)?.new_status, "completed");

  const reopened = await reopenWork(state.repo, "work-1", "Payer reopened the issue.");
  assert.equal(reopened.ok, true);
  assert.equal(state.item.workqueue_status, "reopened");
  assert.equal(state.item.completed_at, null);
  assert.equal(state.history.at(-1)?.old_status, "completed");
  assert.equal(state.history.at(-1)?.new_status, "reopened");
});

test("Mailroom work routes to the exact Correspondence 360 record", () => {
  assert.equal(
    sourceRouteForWorkItem("mailroom_item", "mail-1"),
    "/mailroom/mail-1",
  );
});

test("Mailroom work context resolves human-readable patient, provider, payer, and subject", () => {
  const context = resolveMailroomWorkContext({
    mailroomItem: {
      id: "mail-1",
      subject: "Medical records request",
      client_id: "client-1",
      provider_id: "provider-1",
      payer_id: "payer-1",
      claim_id: "claim-1",
    },
    linkedClaim: {
      id: "claim-1",
      patient_control_number: "DEMO-001",
      client_id: "client-1",
      payer_id: "payer-1",
    },
    client: { id: "client-1", first_name: "Jordan", last_name: "Ellis" },
    provider: { id: "provider-1", first_name: "Samantha", last_name: "Thomas" },
    payer: { id: "payer-1", name: "Aetna" },
  });

  assert.equal(context.clientId, "client-1");
  assert.equal(context.providerId, "provider-1");
  assert.equal(context.payerId, "payer-1");
  assert.equal(context.patientName, "Jordan Ellis");
  assert.equal(context.providerName, "Samantha Thomas");
  assert.equal(context.payerName, "Aetna");
  assert.equal(context.relatedName, "Medical records request · Jordan Ellis · DEMO-001");
  assert.doesNotMatch(context.relatedName, /client-1|provider-1|payer-1|claim-1/);
});

test("RCM work items open their owning queues and exact correction records", () => {
  assert.equal(
    workRouteForWorkItem("encounter", "enc-1", "billing_readiness_blocked"),
    "/billing/charges?tab=blocked&focus=enc-1",
  );
  assert.equal(
    workRouteForWorkItem("charge", "charge-1", "billing_readiness_blocked", { encounterId: "enc-2" }),
    "/billing/charges?tab=blocked&focus=enc-2",
  );
  assert.equal(
    workRouteForWorkItem("claim", "claim-1", "claim_validation"),
    "/rejections?claim=claim-1",
  );
  assert.equal(
    workRouteForWorkItem("claim", "claim-2", "claim_rejection"),
    "/rejections?claim=claim-2",
  );
  assert.equal(
    workRouteForWorkItem("claim", "claim-3", "claim_follow_up"),
    "/claims?claim=claim-3",
  );
  assert.equal(
    workRouteForWorkItem("denial", "denial-1", "denial_followup"),
    "/denials?denial=denial-1",
  );
  assert.equal(
    workRouteForWorkItem("appeal", "appeal-1", "appeal_deadline"),
    "/denials?tab=appeals&appeal=appeal-1",
  );
  assert.equal(
    workRouteForWorkItem("payment", "payment-1", "payment_exception"),
    "/payments?payment=payment-1",
  );
  assert.equal(
    workRouteForWorkItem("adjustment", "adjustment-1", "recoupment"),
    "/payments?tab=recovery",
  );
  assert.equal(
    workRouteForWorkItem("encounter", "enc-3", "documentation"),
    "/encounters/enc-3#encounter-progress-note-editor",
  );
});

test("actual billing and ERA queue types open the field needing attention", () => {
  assert.equal(
    workRouteForWorkItem("encounter", "enc-1", "missing_documentation"),
    "/encounters/enc-1#encounter-progress-note-editor",
  );
  assert.equal(
    workRouteForWorkItem("encounter", "enc-1", "eligibility_issue", { clientId: "client-1" }),
    "/clients/client-1?tab=coverage",
  );
  assert.equal(
    workRouteForWorkItem("encounter", "enc-1", "credentialing_issue"),
    "/payers-contracts",
  );
  assert.equal(
    workRouteForWorkItem("era", "era-1", "unmatched_era"),
    "/payments?tab=era",
  );
  assert.equal(
    workRouteForWorkItem("claim", "claim-1", "payment_posting_issue"),
    "/payments?tab=unapplied",
  );
});

test("source records remain reachable separately from exception destinations", () => {
  assert.equal(sourceRouteForWorkItem("encounter", "enc-1"), "/encounters/enc-1");
  assert.equal(sourceRouteForWorkItem("claim_batch", "batch-1"), "/billing/charges?tab=batches");
  assert.equal(sourceRouteForWorkItem("denial", "denial-1"), "/denials?denial=denial-1");
  assert.equal(sourceRouteForWorkItem("era", "era-1"), "/payments?tab=era");
  assert.equal(
    workRouteForWorkItem("mailroom_item", "mail-1", "correspondence_followup"),
    "/mailroom/mail-1",
  );
});
