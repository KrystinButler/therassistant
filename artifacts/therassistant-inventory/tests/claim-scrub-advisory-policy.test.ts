import test from "node:test";
import assert from "node:assert/strict";

import {
  validateClaimWorkflow,
  type ClaimsRepository,
} from "../src/domains/claims/workflow.ts";

type Row = Record<string, any> & { id: string };

function makeRepo(options: {
  enrollmentStatus?: string | null;
  encounterBillingStatus?: string | null;
} = {}) {
  let claim: Row = {
    id: "claim-1",
    claim_status: "ready_for_validation",
    client_id: "client-1",
    payer_id: "payer-1",
    rendering_provider_id: "provider-1",
    service_date_from: "2026-10-06",
    total_charge_cents: 17500,
    source_encounter_id: "encounter-1",
  };
  const workItems: Row[] = [];

  const repo: ClaimsRepository = {
    async getClaim() { return claim; },
    async getClaimLines() {
      return [{
        id: "line-1",
        service_date: "2026-10-06",
        cpt_code: "90837",
        units: 1,
        charge_amount_cents: 17500,
        diagnosis_pointer: "1",
        place_of_service: "10",
      }];
    },
    async getClaimDiagnoses() {
      return [{ id: "dx-1", diagnosis_code: "F41.1", pointer_order: 1 }];
    },
    async getProviderEnrollmentStatus() {
      return options.enrollmentStatus ?? "approved";
    },
    async getEncounterBillingStatus() {
      return options.encounterBillingStatus ?? "charged";
    },
    async updateClaim(_claimId, values) {
      claim = { ...claim, ...values };
      return claim;
    },
    async insertClaimHistory(values) { return { id: "history-1", ...values }; },
    async createBatch(values) { return { id: "batch-1", ...values }; },
    async addClaimToBatch(values) { return { id: "batch-item-1", ...values }; },
    async getBatch() { return null; },
    async getBatchClaims() { return []; },
    async updateBatch(_id, values) { return { id: "batch-1", ...values }; },
    async createSubmission(values) { return { id: "submission-1", ...values }; },
    async getSubmission() { return null; },
    async updateSubmission(_id, values) { return { id: "submission-1", ...values }; },
    async createSubmissionResponse(values) { return { id: "response-1", ...values }; },
    async getSubmissionResponses() { return []; },
    async upsertWorkItem(values) {
      const row = { id: `work-${workItems.length + 1}`, ...values };
      workItems.push(row);
      return row;
    },
  };

  return { repo, get claim() { return claim; }, workItems };
}

test("pending provider enrollment does not fail an otherwise valid Claim Scrub", async () => {
  const state = makeRepo({ enrollmentStatus: "submitted" });

  const result = await validateClaimWorkflow(state.repo, "claim-1");

  assert.equal(result.ok, true);
  assert.equal(state.claim.claim_status, "ready_for_batch");
  assert.equal(state.workItems.length, 0);
});

test("source encounter readiness does not fail an otherwise valid Claim Scrub", async () => {
  const state = makeRepo({ encounterBillingStatus: "ready" });

  const result = await validateClaimWorkflow(state.repo, "claim-1");

  assert.equal(result.ok, true);
  assert.equal(state.claim.claim_status, "ready_for_batch");
  assert.equal(state.workItems.length, 0);
});
