import {
  blocked,
  failure,
  success,
  type WorkflowResult,
} from "../shared/workflow-result";

export type ClaimRow = Record<string, any> & { id: string };

export type ClaimsRepository = {
  getClaim(claimId: string): Promise<ClaimRow | null>;
  getClaimLines(claimId: string): Promise<ClaimRow[]>;
  getClaimDiagnoses(claimId: string): Promise<ClaimRow[]>;
  getProviderEnrollmentStatus(claim: ClaimRow): Promise<string | null>;
  getEncounterBillingStatus(claim: ClaimRow): Promise<string | null>;
  updateClaim(claimId: string, values: Record<string, unknown>): Promise<ClaimRow>;
  insertClaimHistory(values: Record<string, unknown>): Promise<ClaimRow>;
  createBatch(values: Record<string, unknown>): Promise<ClaimRow>;
  addClaimToBatch(values: Record<string, unknown>): Promise<ClaimRow>;
  getBatch(batchId: string): Promise<ClaimRow | null>;
  getBatchClaims(batchId: string): Promise<ClaimRow[]>;
  updateBatch(batchId: string, values: Record<string, unknown>): Promise<ClaimRow>;
  createSubmission(values: Record<string, unknown>): Promise<ClaimRow>;
  getSubmission(submissionId: string): Promise<ClaimRow | null>;
  updateSubmission(submissionId: string, values: Record<string, unknown>): Promise<ClaimRow>;
  createSubmissionResponse(values: Record<string, unknown>): Promise<ClaimRow>;
  upsertWorkItem(values: Record<string, unknown>): Promise<ClaimRow>;
};

function claimValidationIssues(
  claim: ClaimRow,
  lines: ClaimRow[],
  diagnoses: ClaimRow[],
  enrollmentStatus: string | null,
  encounterBillingStatus: string | null,
) {
  const issues: string[] = [];

  if (!claim.client_id) issues.push("Patient is missing.");
  if (!claim.payer_id) issues.push("Payer is missing.");
  if (!claim.rendering_provider_id) issues.push("Rendering provider is missing.");
  if (!claim.service_date_from) issues.push("Service date is missing.");
  if (!lines.length) issues.push("At least one claim line is required.");
  if (!diagnoses.length) issues.push("At least one diagnosis is required.");
  if (Number(claim.total_charge_cents ?? 0) <= 0) issues.push("Claim charge must be greater than zero.");

  for (const line of lines) {
    if (!line.service_date) issues.push("Claim line service date is missing.");
    if (!String(line.cpt_code ?? "").trim()) issues.push("Claim line CPT/HCPCS is missing.");
    if (Number(line.units ?? 0) <= 0) issues.push("Claim line units must be greater than zero.");
    if (Number(line.charge_amount_cents ?? 0) <= 0) issues.push("Claim line charge must be greater than zero.");
    if (!String(line.diagnosis_pointer ?? "").trim()) issues.push("Claim line diagnosis pointer is missing.");
  }

  if (enrollmentStatus !== "approved") {
    issues.push("Rendering provider is not approved with the payer.");
  }
  if (encounterBillingStatus && !["charged", "claimed"].includes(encounterBillingStatus)) {
    issues.push("Source encounter has not completed billing readiness and charge creation.");
  }

  return [...new Set(issues)];
}

async function recordStatus(
  repo: ClaimsRepository,
  claim: ClaimRow,
  newStatus: string,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  const oldStatus = String(claim.claim_status ?? "ready_for_validation");
  const updated = await repo.updateClaim(claim.id, {
    claim_status: newStatus,
    ...extra,
  });
  await repo.insertClaimHistory({
    claim_id: claim.id,
    old_status: oldStatus,
    new_status: newStatus,
    reason,
  });
  return updated;
}

export async function validateClaimWorkflow(
  repo: ClaimsRepository,
  claimId: string,
): Promise<WorkflowResult<{ claimId: string; status: string }>> {
  const claim = await repo.getClaim(claimId);
  if (!claim) return failure("claim_not_found", "Claim not found.");

  if (!["ready_for_validation", "validation_failed", "corrected"].includes(String(claim.claim_status))) {
    return blocked(
      "invalid_validation_state",
      `Claim cannot be validated from ${String(claim.claim_status)} status.`,
    );
  }

  const [lines, diagnoses, enrollmentStatus, encounterBillingStatus] = await Promise.all([
    repo.getClaimLines(claimId),
    repo.getClaimDiagnoses(claimId),
    repo.getProviderEnrollmentStatus(claim),
    repo.getEncounterBillingStatus(claim),
  ]);

  const issues = claimValidationIssues(
    claim,
    lines,
    diagnoses,
    enrollmentStatus,
    encounterBillingStatus,
  );

  if (issues.length) {
    await recordStatus(repo, claim, "validation_failed", "Claim scrub failed.");
    await repo.upsertWorkItem({
      workqueue_type: "claim_validation",
      source_object_type: "claim",
      source_object_id: claim.id,
      title: "Claim validation failed",
      description: issues.join(" "),
      priority: "high",
      workqueue_status: "open",
    });
    return blocked("claim_validation_failed", "Claim failed validation.", issues);
  }

  await recordStatus(repo, claim, "ready_for_batch", "Claim validation passed.");
  return success({ claimId, status: "ready_for_batch" });
}

export async function createBatchWorkflow(
  repo: ClaimsRepository,
  claimIds: string[],
  batchName = `837P Demo ${new Date().toISOString().slice(0, 10)}`,
): Promise<WorkflowResult<{ batchId: string; claimCount: number }>> {
  if (!claimIds.length) return blocked("no_claims", "Select at least one claim for the batch.");

  const claims: ClaimRow[] = [];
  for (const claimId of claimIds) {
    const claim = await repo.getClaim(claimId);
    if (!claim) return failure("claim_not_found", `Claim ${claimId} was not found.`);
    if (String(claim.claim_status) !== "ready_for_batch") {
      return blocked(
        "claim_not_ready_for_batch",
        "All claims must pass validation before batching.",
        [`${claim.patient_control_number || claim.id} is ${String(claim.claim_status)}.`],
      );
    }
    claims.push(claim);
  }

  const totalChargeCents = claims.reduce(
    (sum, claim) => sum + Number(claim.total_charge_cents ?? 0),
    0,
  );

  try {
    const batch = await repo.createBatch({
      batch_status: "created",
      batch_name: batchName,
      claim_count: claims.length,
      total_charge_cents: totalChargeCents,
    });

    for (const claim of claims) {
      await repo.addClaimToBatch({ batch_id: batch.id, claim_id: claim.id });
      await recordStatus(repo, claim, "batched", `Added to batch ${batchName}.`);
    }

    await repo.updateBatch(batch.id, { batch_status: "ready" });
    return success({ batchId: batch.id, claimCount: claims.length });
  } catch (error) {
    return failure(
      "batch_creation_failed",
      error instanceof Error ? error.message : "Unable to create claim batch.",
    );
  }
}

export async function submitBatchWorkflow(
  repo: ClaimsRepository,
  batchId: string,
): Promise<WorkflowResult<{ batchId: string; submissionId: string; claimCount: number }>> {
  const batch = await repo.getBatch(batchId);
  if (!batch) return failure("batch_not_found", "Claim batch not found.");
  if (!["ready", "created"].includes(String(batch.batch_status))) {
    return blocked(
      "batch_not_ready",
      `Batch cannot be submitted from ${String(batch.batch_status)} status.`,
    );
  }

  const claims = await repo.getBatchClaims(batchId);
  if (!claims.length) return blocked("empty_batch", "Batch has no claims to submit.");
  const invalid = claims.filter((claim) => String(claim.claim_status) !== "batched");
  if (invalid.length) {
    return blocked(
      "batch_claim_state_invalid",
      "Every claim in the batch must be in batched status before submission.",
      invalid.map((claim) => `${claim.patient_control_number || claim.id}: ${String(claim.claim_status)}`),
    );
  }

  const submittedAt = new Date().toISOString();

  try {
    const submission = await repo.createSubmission({
      batch_id: batchId,
      submission_status: "submitted",
      submission_method: "837P_demo",
      submitted_at: submittedAt,
    });

    await repo.updateBatch(batchId, {
      batch_status: "submitted",
      submitted_at: submittedAt,
    });

    for (const claim of claims) {
      await recordStatus(repo, claim, "submitted", "837P demo batch submitted.", {
        submitted_at: submittedAt,
      });
    }

    return success({ batchId, submissionId: submission.id, claimCount: claims.length });
  } catch (error) {
    return failure(
      "batch_submission_failed",
      error instanceof Error ? error.message : "Unable to submit claim batch.",
    );
  }
}

export async function applySyntheticClearinghouseResponseWorkflow(
  repo: ClaimsRepository,
  submissionId: string,
  outcome: "accepted" | "rejected",
  responseCode?: string,
  responseMessage?: string,
): Promise<WorkflowResult<{ submissionId: string; outcome: string; claimCount: number }>> {
  const submission = await repo.getSubmission(submissionId);
  if (!submission) return failure("submission_not_found", "Claim submission not found.");
  if (!submission.batch_id && !submission.claim_id) {
    return failure("submission_unlinked", "Submission is not linked to a batch or claim.");
  }

  const claims = submission.batch_id
    ? await repo.getBatchClaims(String(submission.batch_id))
    : [await repo.getClaim(String(submission.claim_id))].filter(Boolean) as ClaimRow[];

  if (!claims.length) return failure("submission_claims_missing", "No claims were found for the submission.");

  const responseStatus = outcome === "accepted" ? "accepted" : "rejected";
  const now = new Date().toISOString();

  try {
    for (const claim of claims) {
      await repo.createSubmissionResponse({
        submission_id: submissionId,
        claim_id: claim.id,
        response_status: responseStatus,
        response_code: responseCode || (outcome === "accepted" ? "A1" : "A3"),
        response_message:
          responseMessage ||
          (outcome === "accepted"
            ? "Demo clearinghouse accepted the claim."
            : "Demo clearinghouse rejected the claim for correction."),
        raw_response: {
          demo: true,
          outcome,
          responseCode: responseCode || null,
        },
      });

      await recordStatus(
        repo,
        claim,
        responseStatus,
        outcome === "accepted" ? "Clearinghouse accepted claim." : "Clearinghouse rejected claim.",
        outcome === "accepted" ? { accepted_at: now } : {},
      );

      if (outcome === "rejected") {
        await repo.upsertWorkItem({
          workqueue_type: "claim_rejection",
          source_object_type: "claim",
          source_object_id: claim.id,
          title: "Clearinghouse rejection requires correction",
          description:
            responseMessage || "Review the rejection, correct the claim, and resubmit it.",
          priority: "high",
          workqueue_status: "open",
        });
      }
    }

    await repo.updateSubmission(submissionId, {
      submission_status: responseStatus,
      response_payload: {
        demo: true,
        outcome,
        responseCode: responseCode || null,
        claimCount: claims.length,
      },
    });

    if (submission.batch_id) {
      await repo.updateBatch(String(submission.batch_id), {
        batch_status: outcome === "accepted" ? "accepted" : "rejected",
      });
    }

    return success({ submissionId, outcome, claimCount: claims.length });
  } catch (error) {
    return failure(
      "clearinghouse_response_failed",
      error instanceof Error ? error.message : "Unable to apply clearinghouse response.",
    );
  }
}
