import {
  blocked,
  failure,
  success,
  type WorkflowResult,
} from "../shared/workflow-result";

export type ClaimRow = Record<string, any> & { id: string };

export type ClaimCreationRepository = {
  getCharges(chargeIds: string[]): Promise<ClaimRow[]>;
  createClaim(values: Record<string, unknown>): Promise<ClaimRow>;
  createClaimLine(values: Record<string, unknown>): Promise<ClaimRow>;
  createClaimDiagnosis(values: Record<string, unknown>): Promise<ClaimRow>;
  updateCharge(chargeId: string, values: Record<string, unknown>): Promise<ClaimRow>;
  updateEncounter(encounterId: string, values: Record<string, unknown>): Promise<ClaimRow>;
};

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
  getSubmissionResponses(submissionId: string): Promise<ClaimRow[]>;
  upsertWorkItem(values: Record<string, unknown>): Promise<ClaimRow>;
};

export async function createClaimFromChargesWorkflow(
  repo: ClaimCreationRepository,
  chargeIds: string[],
): Promise<WorkflowResult<{ claim: ClaimRow; lineCount: number; diagnosisCount: number }>> {
  if (!chargeIds.length) {
    return blocked("no_charges", "Select at least one ready charge to create a claim.");
  }

  const charges = await repo.getCharges(chargeIds);
  if (charges.length !== chargeIds.length) {
    return failure("charge_not_found", "One or more selected charges were not found.");
  }

  const invalid = charges.filter((charge) => charge.charge_status !== "ready_for_claim");
  if (invalid.length) {
    return blocked(
      "charge_not_ready",
      "Every selected charge must be ready for claim creation.",
      invalid.map((charge) => `${charge.id}: ${String(charge.charge_status)}`),
    );
  }

  const first = charges[0];
  const contextKeys = ["encounter_id", "client_id", "provider_id", "payer_id"] as const;
  for (const key of contextKeys) {
    const expected = String(first[key] ?? "");
    if (charges.some((charge) => String(charge[key] ?? "") !== expected)) {
      return blocked(
        "mixed_claim_context",
        "Selected charges must belong to the same encounter, patient, provider, and payer.",
      );
    }
  }

  const diagnoses = [...new Set(
    charges
      .map((charge) => String(charge.diagnosis_code ?? "").trim().toUpperCase())
      .filter(Boolean),
  )];
  if (!diagnoses.length) {
    return blocked("claim_diagnosis_missing", "At least one diagnosis is required to create a claim.");
  }

  const dates = charges.map((charge) => String(charge.service_date ?? "")).filter(Boolean).sort();
  const totalChargeCents = charges.reduce(
    (sum, charge) => sum + Number(charge.charge_amount_cents ?? 0),
    0,
  );

  try {
    const claim = await repo.createClaim({
      charge_id: first.id,
      client_id: first.client_id,
      rendering_provider_id: first.provider_id || null,
      billing_provider_id: first.provider_id || null,
      payer_id: first.payer_id || null,
      claim_status: "ready_for_validation",
      service_date_from: dates[0] || null,
      service_date_to: dates.at(-1) || dates[0] || null,
      total_charge_cents: totalChargeCents,
      patient_control_number: `TH-${Date.now().toString().slice(-10)}`,
      source_encounter_id: first.encounter_id || null,
      metadata: { source: "encounter_charge" },
    });

    for (const charge of charges) {
      const diagnosisCode = String(charge.diagnosis_code ?? "").trim().toUpperCase();
      const pointer = Math.max(1, diagnoses.indexOf(diagnosisCode) + 1);
      await repo.createClaimLine({
        claim_id: claim.id,
        service_date: charge.service_date,
        cpt_code: charge.cpt_code,
        modifier1: charge.modifier1 || null,
        modifier2: charge.modifier2 || null,
        diagnosis_pointer: String(pointer),
        place_of_service: charge.place_of_service || null,
        units: Number(charge.units ?? 1),
        charge_amount_cents: Number(charge.charge_amount_cents ?? 0),
      });
    }

    for (const [index, diagnosisCode] of diagnoses.entries()) {
      await repo.createClaimDiagnosis({
        claim_id: claim.id,
        diagnosis_code: diagnosisCode,
        pointer_order: index + 1,
      });
    }

    // Claim structure is persisted before source charges are moved forward.
    for (const charge of charges) {
      await repo.updateCharge(charge.id, {
        charge_status: "claim_created",
        block_reason: null,
      });
    }

    if (first.encounter_id) {
      await repo.updateEncounter(String(first.encounter_id), {
        billing_status: "claimed",
      });
    }

    return success({
      claim,
      lineCount: charges.length,
      diagnosisCount: diagnoses.length,
    });
  } catch (error) {
    return failure(
      "claim_creation_failed",
      error instanceof Error ? error.message : "Unable to create claim from charges.",
    );
  }
}

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
    if (!/^\d{2}$/.test(String(line.place_of_service ?? ""))) issues.push("Claim line place of service must be a two-digit code.");
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
  batchName = `837P ${new Date().toISOString().slice(0, 10)}`,
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

export async function recordExternalSubmissionWorkflow(
  repo: ClaimsRepository,
  batchId: string,
  externalReference: string,
  submissionMethod = "external_837p",
): Promise<WorkflowResult<{ batchId: string; submissionId: string; claimCount: number }>> {
  const reference = externalReference.trim();
  if (!reference) {
    return blocked(
      "external_reference_required",
      "Enter the clearinghouse or submission reference before recording submission.",
    );
  }

  const batch = await repo.getBatch(batchId);
  if (!batch) return failure("batch_not_found", "Claim batch not found.");
  if (!["ready", "created"].includes(String(batch.batch_status))) {
    return blocked(
      "batch_not_ready",
      `Batch cannot be recorded as submitted from ${String(batch.batch_status)} status.`,
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
      submission_method: submissionMethod,
      submitted_at: submittedAt,
      response_payload: {
        external_reference: reference,
        recorded_source: "user_confirmed_external_submission",
      },
    });

    await repo.updateBatch(batchId, {
      batch_status: "submitted",
      submitted_at: submittedAt,
    });

    for (const claim of claims) {
      await recordStatus(
        repo,
        claim,
        "submitted",
        `External 837P submission recorded. Reference: ${reference}.`,
        { submitted_at: submittedAt },
      );
    }

    return success({ batchId, submissionId: submission.id, claimCount: claims.length });
  } catch (error) {
    return failure(
      "batch_submission_record_failed",
      error instanceof Error ? error.message : "Unable to record external claim submission.",
    );
  }
}

export type ExternalAcknowledgementInput = {
  submissionId: string;
  claimId: string;
  outcome: "accepted" | "rejected";
  acknowledgementType: "999" | "277CA" | "clearinghouse_portal" | "other";
  responseCode: string;
  responseMessage: string;
  externalReference: string;
};

export async function recordExternalClaimAcknowledgementWorkflow(
  repo: ClaimsRepository,
  input: ExternalAcknowledgementInput,
): Promise<WorkflowResult<{
  submissionId: string;
  claimId: string;
  outcome: string;
  submissionStatus: string;
}>> {
  const submission = await repo.getSubmission(input.submissionId);
  if (!submission) return failure("submission_not_found", "Claim submission not found.");

  const claim = await repo.getClaim(input.claimId);
  if (!claim) return failure("claim_not_found", "Claim not found.");

  const reference = input.externalReference.trim();
  const responseCode = input.responseCode.trim();
  const responseMessage = input.responseMessage.trim();
  if (!reference) {
    return blocked("ack_reference_required", "Enter the acknowledgement or clearinghouse reference.");
  }
  if (!responseCode) {
    return blocked("ack_code_required", "Enter the acknowledgement response code.");
  }
  if (!responseMessage) {
    return blocked("ack_message_required", "Enter the acknowledgement response message.");
  }
  if (!["submitted", "accepted", "rejected"].includes(String(claim.claim_status))) {
    return blocked(
      "claim_not_awaiting_acknowledgement",
      `Claim cannot receive a clearinghouse acknowledgement from ${String(claim.claim_status)} status.`,
    );
  }

  let submissionClaims: ClaimRow[] = [];
  if (submission.batch_id) {
    submissionClaims = await repo.getBatchClaims(String(submission.batch_id));
  } else if (submission.claim_id) {
    const linked = await repo.getClaim(String(submission.claim_id));
    if (linked) submissionClaims = [linked];
  }
  if (!submissionClaims.some((row) => row.id === claim.id)) {
    return blocked(
      "claim_not_in_submission",
      "The selected claim does not belong to this submission.",
    );
  }

  const responseStatus = input.outcome;
  const now = new Date().toISOString();

  try {
    const existingResponses = await repo.getSubmissionResponses(input.submissionId);
    const existingForClaim = existingResponses
      .filter((row) => String(row.claim_id ?? "") === claim.id)
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];

    if (
      existingForClaim &&
      String(existingForClaim.response_status ?? "") === responseStatus &&
      String(existingForClaim.response_code ?? "") === responseCode &&
      String(existingForClaim.raw_response?.external_reference ?? "") === reference
    ) {
      return blocked(
        "duplicate_acknowledgement",
        "This acknowledgement has already been recorded for the claim.",
      );
    }

    await repo.createSubmissionResponse({
      submission_id: input.submissionId,
      claim_id: claim.id,
      response_status: responseStatus,
      response_code: responseCode,
      response_message: responseMessage,
      raw_response: {
        source: "external_acknowledgement",
        acknowledgement_type: input.acknowledgementType,
        external_reference: reference,
        recorded_at: now,
      },
    });

    await recordStatus(
      repo,
      claim,
      responseStatus,
      `${input.acknowledgementType} acknowledgement recorded: ${responseCode} — ${responseMessage}`,
      input.outcome === "accepted" ? { accepted_at: now } : {},
    );

    if (input.outcome === "rejected") {
      await repo.upsertWorkItem({
        workqueue_type: "claim_rejection",
        source_object_type: "claim",
        source_object_id: claim.id,
        title: "Clearinghouse rejection requires correction",
        description: `${input.acknowledgementType} ${responseCode}. ${responseMessage}`,
        priority: "high",
        workqueue_status: "open",
      });
    }

    const responses = [
      ...existingResponses,
      {
        id: "new-response",
        claim_id: claim.id,
        response_status: responseStatus,
        response_code: responseCode,
      },
    ];
    const latestByClaim = new Map<string, ClaimRow>();
    for (const response of responses) {
      const claimId = String(response.claim_id ?? "");
      if (!claimId) continue;
      const current = latestByClaim.get(claimId);
      if (!current || String(response.created_at ?? now) >= String(current.created_at ?? "")) {
        latestByClaim.set(claimId, response);
      }
    }

    const allResponded = submissionClaims.every((row) => latestByClaim.has(row.id));
    const anyRejected = [...latestByClaim.values()].some(
      (row) => String(row.response_status ?? "") === "rejected",
    );
    const allAccepted =
      allResponded &&
      submissionClaims.every(
        (row) => String(latestByClaim.get(row.id)?.response_status ?? "") === "accepted",
      );
    const submissionStatus = allAccepted
      ? "accepted"
      : allResponded && anyRejected
        ? "rejected"
        : "pending_response";

    const originalPayload =
      submission.response_payload &&
      typeof submission.response_payload === "object" &&
      !Array.isArray(submission.response_payload)
        ? submission.response_payload
        : {};

    await repo.updateSubmission(input.submissionId, {
      submission_status: submissionStatus,
      response_payload: {
        ...originalPayload,
        latest_acknowledgement_type: input.acknowledgementType,
        latest_external_reference: reference,
        latest_response_code: responseCode,
        responded_claim_count: latestByClaim.size,
        total_claim_count: submissionClaims.length,
      },
    });

    if (submission.batch_id) {
      await repo.updateBatch(String(submission.batch_id), {
        batch_status: submissionStatus,
      });
    }

    return success({
      submissionId: input.submissionId,
      claimId: claim.id,
      outcome: input.outcome,
      submissionStatus,
    });
  } catch (error) {
    return failure(
      "external_acknowledgement_failed",
      error instanceof Error ? error.message : "Unable to record external claim acknowledgement.",
    );
  }
}
