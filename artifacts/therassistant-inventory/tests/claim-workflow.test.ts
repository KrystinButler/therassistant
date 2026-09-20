import test from "node:test";
import assert from "node:assert/strict";

import {
  applySyntheticClearinghouseResponseWorkflow,
  createBatchWorkflow,
  createClaimFromChargesWorkflow,
  submitBatchWorkflow,
  validateClaimWorkflow,
  type ClaimsRepository,
} from "../src/domains/claims/workflow.ts";

type Row = Record<string, any> & { id: string };

function makeRepo() {
  const claims = new Map<string, Row>([
    ["claim-1", {
      id: "claim-1",
      claim_status: "ready_for_validation",
      client_id: "client-1",
      payer_id: "payer-1",
      rendering_provider_id: "provider-1",
      service_date_from: "2026-09-13",
      total_charge_cents: 12500,
      source_encounter_id: "encounter-1",
    }],
  ]);
  const lines = new Map<string, Row[]>([
    ["claim-1", [{ id: "line-1", claim_id: "claim-1", service_date: "2026-09-13", cpt_code: "90837", units: 1, charge_amount_cents: 12500, diagnosis_pointer: "1" }]],
  ]);
  const diagnoses = new Map<string, Row[]>([
    ["claim-1", [{ id: "dx-1", claim_id: "claim-1", diagnosis_code: "F41.1", pointer_order: 1 }]],
  ]);
  const submissions: Row[] = [];
  const responses: Row[] = [];
  const workItems: Row[] = [];
  const histories: Row[] = [];
  const batches = new Map<string, Row>();
  const batchItems: Row[] = [];
  const callOrder: string[] = [];

  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const repo: ClaimsRepository = {
    async getClaim(claimId) { return claims.get(claimId) ?? null; },
    async getClaimLines(claimId) { return lines.get(claimId) ?? []; },
    async getClaimDiagnoses(claimId) { return diagnoses.get(claimId) ?? []; },
    async getProviderEnrollmentStatus() { return "approved"; },
    async getEncounterBillingStatus() { return "charged"; },
    async updateClaim(claimId, values) {
      callOrder.push(`claim:${String(values.claim_status ?? "update")}`);
      const current = claims.get(claimId);
      if (!current) throw new Error("Claim not found");
      const updated = { ...current, ...values };
      claims.set(claimId, updated);
      return updated;
    },
    async insertClaimHistory(values) {
      const row = { id: id("history"), ...values };
      histories.push(row);
      return row;
    },
    async createBatch(values) {
      const row = { id: id("batch"), ...values };
      batches.set(row.id, row);
      return row;
    },
    async addClaimToBatch(values) {
      const row = { id: id("batch-item"), ...values };
      batchItems.push(row);
      return row;
    },
    async getBatch(batchId) { return batches.get(batchId) ?? null; },
    async getBatchClaims(batchId) {
      return batchItems
        .filter((item) => item.batch_id === batchId)
        .map((item) => claims.get(item.claim_id))
        .filter(Boolean) as Row[];
    },
    async updateBatch(batchId, values) {
      const current = batches.get(batchId);
      if (!current) throw new Error("Batch not found");
      const updated = { ...current, ...values };
      batches.set(batchId, updated);
      return updated;
    },
    async createSubmission(values) {
      callOrder.push("submission:create");
      const row = { id: id("submission"), ...values };
      submissions.push(row);
      return row;
    },
    async getSubmission(submissionId) { return submissions.find((row) => row.id === submissionId) ?? null; },
    async updateSubmission(submissionId, values) {
      const index = submissions.findIndex((row) => row.id === submissionId);
      if (index < 0) throw new Error("Submission not found");
      submissions[index] = { ...submissions[index], ...values };
      return submissions[index];
    },
    async createSubmissionResponse(values) {
      const row = { id: id("response"), ...values };
      responses.push(row);
      return row;
    },
    async upsertWorkItem(values) {
      const row = { id: id("work"), ...values };
      workItems.push(row);
      return row;
    },
  };

  return { repo, claims, batches, submissions, responses, workItems, histories, callOrder };
}

test("valid claim moves from validation to ready for batch", async () => {
  const state = makeRepo();
  const result = await validateClaimWorkflow(state.repo, "claim-1");
  assert.equal(result.ok, true);
  assert.equal(state.claims.get("claim-1")?.claim_status, "ready_for_batch");
  assert.equal(state.histories.at(-1)?.new_status, "ready_for_batch");
});

test("batching only accepts claims ready for batch", async () => {
  const state = makeRepo();
  await validateClaimWorkflow(state.repo, "claim-1");
  const result = await createBatchWorkflow(state.repo, ["claim-1"], "Demo 837P Batch");
  assert.equal(result.ok, true);
  assert.equal(state.claims.get("claim-1")?.claim_status, "batched");
  assert.equal([...state.batches.values()][0]?.claim_count, 1);
});

test("submission record is created before claim becomes submitted", async () => {
  const state = makeRepo();
  await validateClaimWorkflow(state.repo, "claim-1");
  const batchResult = await createBatchWorkflow(state.repo, ["claim-1"], "Demo 837P Batch");
  assert.equal(batchResult.ok, true);
  if (!batchResult.ok) return;

  const result = await submitBatchWorkflow(state.repo, batchResult.value.batchId);
  assert.equal(result.ok, true);
  assert.equal(state.submissions.length, 1);
  assert.equal(state.submissions[0].submission_method, "837P_demo");
  assert.equal(state.claims.get("claim-1")?.claim_status, "submitted");
  assert.ok(state.callOrder.indexOf("submission:create") < state.callOrder.indexOf("claim:submitted"));
});

test("clearinghouse rejection persists response and creates follow-up work", async () => {
  const state = makeRepo();
  await validateClaimWorkflow(state.repo, "claim-1");
  const batchResult = await createBatchWorkflow(state.repo, ["claim-1"]);
  if (!batchResult.ok) throw new Error(batchResult.message);
  const submitResult = await submitBatchWorkflow(state.repo, batchResult.value.batchId);
  if (!submitResult.ok) throw new Error(submitResult.message);

  const result = await applySyntheticClearinghouseResponseWorkflow(
    state.repo,
    submitResult.value.submissionId,
    "rejected",
    "A3",
    "Demo clearinghouse rejected the claim for correction.",
  );

  assert.equal(result.ok, true);
  assert.equal(state.responses.length, 1);
  assert.equal(state.claims.get("claim-1")?.claim_status, "rejected");
  assert.equal(state.workItems.length, 1);
  assert.equal(state.workItems[0].workqueue_type, "claim_rejection");
});

test("charges are marked claim-created only after claim lines and diagnoses persist", async () => {
  const calls: string[] = [];
  const createdLines: Row[] = [];
  const createdDiagnoses: Row[] = [];
  const updatedCharges: Row[] = [];

  const charges: Row[] = [
    {
      id: "charge-1",
      charge_status: "ready_for_claim",
      encounter_id: "encounter-1",
      client_id: "client-1",
      provider_id: "provider-1",
      payer_id: "payer-1",
      service_date: "2026-09-13",
      cpt_code: "90837",
      diagnosis_code: "F41.1",
      place_of_service: "10",
      units: 2,
      charge_amount_cents: 12500,
    },
    {
      id: "charge-2",
      charge_status: "ready_for_claim",
      encounter_id: "encounter-1",
      client_id: "client-1",
      provider_id: "provider-1",
      payer_id: "payer-1",
      service_date: "2026-09-13",
      cpt_code: "90785",
      diagnosis_code: "F41.1",
      place_of_service: "10",
      units: 1,
      charge_amount_cents: 1500,
    },
  ];

  const repo = {
    async getCharges(ids: string[]) {
      return charges.filter((row) => ids.includes(row.id));
    },
    async createClaim(values: Record<string, unknown>) {
      calls.push("claim");
      return { id: "claim-new", ...values };
    },
    async createClaimLine(values: Record<string, unknown>) {
      calls.push("line");
      const row = { id: `line-${createdLines.length + 1}`, ...values };
      createdLines.push(row);
      return row;
    },
    async createClaimDiagnosis(values: Record<string, unknown>) {
      calls.push("diagnosis");
      const row = { id: `dx-${createdDiagnoses.length + 1}`, ...values };
      createdDiagnoses.push(row);
      return row;
    },
    async updateCharge(id: string, values: Record<string, unknown>) {
      calls.push(`charge:${String(values.charge_status)}`);
      const row = { id, ...values };
      updatedCharges.push(row);
      return row;
    },
    async updateEncounter(id: string, values: Record<string, unknown>) {
      calls.push("encounter");
      return { id, ...values };
    },
  };

  const result = await createClaimFromChargesWorkflow(repo, ["charge-1", "charge-2"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.claim.source_encounter_id, "encounter-1");
  assert.equal(createdLines.length, 2);
  assert.equal(createdLines[0].units, 2);
  assert.equal(createdLines[1].units, 1);
  assert.equal(createdDiagnoses.length, 1);
  assert.equal(updatedCharges.length, 2);
  assert.ok(calls.lastIndexOf("diagnosis") < calls.indexOf("charge:claim_created"));
});
