import {
  getCurrentTenantId,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import {
  type ClaimCreationRepository,
  type ClaimsRepository,
} from "./workflow";
import {
  blocked,
  failure,
  success,
} from "../shared/workflow-result";

type DataRow = Row & { id: string };
type EnrichedClaimRow = DataRow & {
  clientName: string;
  providerName: string;
  payerName: string;
};
type BatchRow = DataRow & { claimIds: string[] };
type SubmissionRow = DataRow & { responses: DataRow[] };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

const claimCreationRepository: ClaimCreationRepository = {
  getCharges(chargeIds) {
    return tenantSelect<DataRow>("charge_capture_items", {
      id: inFilter(chargeIds),
      order: "service_date.asc",
    });
  },
  createClaim(values) {
    return tenantInsert<DataRow>("professional_claims", values);
  },
  createClaimLine(values) {
    return tenantInsert<DataRow>("professional_claim_lines", values);
  },
  createClaimDiagnosis(values) {
    return tenantInsert<DataRow>("claim_diagnoses", values);
  },
  updateCharge(id, values) {
    return tenantUpdate<DataRow>("charge_capture_items", id, values);
  },
  updateEncounter(id, values) {
    return tenantUpdate<DataRow>("encounters", id, values);
  },
};

const repository: ClaimsRepository = {
  async getClaim(claimId) {
    return first(
      await tenantSelect<DataRow>("professional_claims", {
        id: `eq.${claimId}`,
        limit: "1",
      }),
    );
  },

  getClaimLines(claimId) {
    return tenantSelect<DataRow>("professional_claim_lines", {
      claim_id: `eq.${claimId}`,
      order: "service_date.asc,created_at.asc",
    });
  },

  getClaimDiagnoses(claimId) {
    return tenantSelect<DataRow>("claim_diagnoses", {
      claim_id: `eq.${claimId}`,
      order: "pointer_order.asc",
    });
  },

  async getProviderEnrollmentStatus(claim) {
    if (!claim.rendering_provider_id || !claim.payer_id) return null;
    const enrollment = first(
      await tenantSelect<DataRow>("provider_payer_enrollments", {
        provider_id: `eq.${String(claim.rendering_provider_id)}`,
        payer_id: `eq.${String(claim.payer_id)}`,
        order: "created_at.desc",
        limit: "1",
      }),
    );
    return enrollment ? String(enrollment.enrollment_status ?? "unknown") : null;
  },

  async getEncounterBillingStatus(claim) {
    if (!claim.source_encounter_id) return null;
    const encounter = first(
      await tenantSelect<DataRow>("encounters", {
        id: `eq.${String(claim.source_encounter_id)}`,
        limit: "1",
      }),
    );
    return encounter ? String(encounter.billing_status ?? "not_ready") : null;
  },

  updateClaim(id, values) {
    return tenantUpdate<DataRow>("professional_claims", id, values);
  },

  insertClaimHistory(values) {
    return tenantInsert<DataRow>("claim_status_history", values);
  },

  createBatch(values) {
    return tenantInsert<DataRow>("claim_batches", values);
  },

  addClaimToBatch(values) {
    return tenantInsert<DataRow>("claim_batch_items", values);
  },

  async getBatch(batchId) {
    return first(
      await tenantSelect<DataRow>("claim_batches", {
        id: `eq.${batchId}`,
        limit: "1",
      }),
    );
  },

  async getBatchClaims(batchId) {
    const items = await tenantSelect<DataRow>("claim_batch_items", {
      batch_id: `eq.${batchId}`,
      order: "created_at.asc",
    });
    const claimIds = items.map((item) => String(item.claim_id ?? "")).filter(Boolean);
    if (!claimIds.length) return [];
    return tenantSelect<DataRow>("professional_claims", {
      id: inFilter(claimIds),
      order: "service_date_from.asc",
    });
  },

  updateBatch(id, values) {
    return tenantUpdate<DataRow>("claim_batches", id, values);
  },

  createSubmission(values) {
    return tenantInsert<DataRow>("claim_submissions", values);
  },

  async getSubmission(submissionId) {
    return first(
      await tenantSelect<DataRow>("claim_submissions", {
        id: `eq.${submissionId}`,
        limit: "1",
      }),
    );
  },

  updateSubmission(id, values) {
    return tenantUpdate<DataRow>("claim_submissions", id, values);
  },

  createSubmissionResponse(values) {
    return tenantInsert<DataRow>("submission_responses", values);
  },

  getSubmissionResponses(submissionId) {
    return tenantSelect<DataRow>("submission_responses", {
      submission_id: `eq.${submissionId}`,
      order: "created_at.asc",
    });
  },

  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await tenantSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.claim",
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return tenantUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return tenantInsert<DataRow>("workqueue_items", values);
  },
};

type BackendClaimCreationResult = {
  claim_id: string;
  patient_control_number: string;
  line_count: number;
  diagnosis_count: number;
  total_charge_cents: number;
};

type BackendClaimValidationResult = {
  claim_id: string;
  valid: boolean;
  status: string;
  issues: string[];
};

type BackendBatchResult = {
  batch_id: string;
  claim_count: number;
  payer_id: string;
  total_charge_cents: number;
};

type BackendSubmissionResult = {
  batch_id: string;
  submission_id: string;
  claim_count: number;
  submitted_at: string;
};

type BackendAcknowledgementResult = {
  submission_id: string;
  claim_id: string;
  outcome: string;
  submission_status: string;
  responded_claim_count: number;
  total_claim_count: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createClaimFromCharges(chargeIds: string[]) {
  if (!chargeIds.length) {
    return blocked("no_charges", "Select at least one ready charge to create a claim.");
  }

  try {
    const tenantId = await getCurrentTenantId();
    const result = await tenantRpc<BackendClaimCreationResult>(
      "rcm_create_claim_from_charges",
      {
        p_tenant_id: tenantId,
        p_charge_ids: chargeIds,
      },
    );
    const claim = first(
      await tenantSelect<DataRow>("professional_claims", {
        id: `eq.${result.claim_id}`,
        limit: "1",
      }),
    );
    if (!claim) {
      return failure(
        "claim_creation_failed",
        "The claim was created but could not be reloaded.",
      );
    }

    return success({
      claim,
      lineCount: Number(result.line_count ?? 0),
      diagnosisCount: Number(result.diagnosis_count ?? 0),
    });
  } catch (error) {
    return failure(
      "claim_creation_failed",
      errorMessage(error, "Unable to create claim from charges."),
    );
  }
}

export async function validateClaim(claimId: string) {
  try {
    const result = await tenantRpc<BackendClaimValidationResult>(
      "validate_claim",
      { p_claim_id: claimId },
    );
    const issues = Array.isArray(result.issues) ? result.issues.map(String) : [];
    if (!result.valid) {
      return blocked(
        "claim_validation_failed",
        "Claim failed validation.",
        issues,
      );
    }
    return success({
      claimId: result.claim_id,
      status: String(result.status ?? "ready_for_batch"),
    });
  } catch (error) {
    return failure(
      "claim_validation_failed",
      errorMessage(error, "Unable to validate claim."),
    );
  }
}

export async function createBatch(claimIds: string[], batchName?: string) {
  if (!claimIds.length) {
    return blocked("no_claims", "Select at least one claim for the batch.");
  }

  try {
    const tenantId = await getCurrentTenantId();
    const result = await tenantRpc<BackendBatchResult>(
      "rcm_create_claim_batch",
      {
        p_tenant_id: tenantId,
        p_claim_ids: claimIds,
        p_batch_name: batchName?.trim() || null,
      },
    );
    return success({
      batchId: result.batch_id,
      claimCount: Number(result.claim_count ?? 0),
    });
  } catch (error) {
    return failure(
      "batch_creation_failed",
      errorMessage(error, "Unable to create claim batch."),
    );
  }
}

export async function recordExternalSubmission(
  batchId: string,
  externalReference: string,
  submissionMethod = "external_837p",
) {
  if (!externalReference.trim()) {
    return blocked(
      "external_reference_required",
      "Enter the clearinghouse or submission reference before recording submission.",
    );
  }

  try {
    const tenantId = await getCurrentTenantId();
    const result = await tenantRpc<BackendSubmissionResult>(
      "rcm_record_external_submission",
      {
        p_tenant_id: tenantId,
        p_batch_id: batchId,
        p_external_reference: externalReference.trim(),
        p_submission_method: submissionMethod,
      },
    );
    return success({
      batchId: result.batch_id,
      submissionId: result.submission_id,
      claimCount: Number(result.claim_count ?? 0),
    });
  } catch (error) {
    return failure(
      "batch_submission_record_failed",
      errorMessage(error, "Unable to record external claim submission."),
    );
  }
}

export async function recordExternalClaimAcknowledgement(input: {
  submissionId: string;
  claimId: string;
  outcome: "accepted" | "rejected";
  acknowledgementType: "999" | "277CA" | "clearinghouse_portal" | "other";
  responseCode: string;
  responseMessage: string;
  externalReference: string;
}) {
  if (!input.externalReference.trim()) {
    return blocked(
      "ack_reference_required",
      "Enter the acknowledgement or clearinghouse reference.",
    );
  }
  if (!input.responseCode.trim()) {
    return blocked("ack_code_required", "Enter the acknowledgement response code.");
  }
  if (!input.responseMessage.trim()) {
    return blocked(
      "ack_message_required",
      "Enter the acknowledgement response message.",
    );
  }

  try {
    const tenantId = await getCurrentTenantId();
    const result = await tenantRpc<BackendAcknowledgementResult>(
      "rcm_record_external_acknowledgement",
      {
        p_tenant_id: tenantId,
        p_submission_id: input.submissionId,
        p_claim_id: input.claimId,
        p_outcome: input.outcome,
        p_acknowledgement_type: input.acknowledgementType,
        p_response_code: input.responseCode.trim(),
        p_response_message: input.responseMessage.trim(),
        p_external_reference: input.externalReference.trim(),
      },
    );
    return success({
      submissionId: result.submission_id,
      claimId: result.claim_id,
      outcome: result.outcome,
      submissionStatus: result.submission_status,
    });
  } catch (error) {
    return failure(
      "external_acknowledgement_failed",
      errorMessage(error, "Unable to record external claim acknowledgement."),
    );
  }
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export async function getClaimSubmissionData() {
  const [claims, clients, providers, payers, batches, batchItems, submissions, responses] = await Promise.all([
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clients"),
    tenantSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("claim_batches", { order: "created_at.desc" }),
    tenantSelect<DataRow>("claim_batch_items", { order: "created_at.desc" }),
    tenantSelect<DataRow>("claim_submissions", { order: "created_at.desc" }),
    tenantSelect<DataRow>("submission_responses", { order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const claimRows = claims.map((claim): EnrichedClaimRow => ({
    ...claim,
    clientName: personName(clientsById.get(String(claim.client_id))),
    providerName: personName(providersById.get(String(claim.rendering_provider_id))),
    payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"),
  }));

  const claimIdsByBatch = new Map<string, string[]>();
  for (const item of batchItems) {
    const batchId = String(item.batch_id ?? "");
    const list = claimIdsByBatch.get(batchId) ?? [];
    list.push(String(item.claim_id ?? ""));
    claimIdsByBatch.set(batchId, list);
  }

  const batchRows = batches.map((batch): BatchRow => ({
    ...batch,
    claimIds: claimIdsByBatch.get(batch.id) ?? [],
  }));

  const responseBySubmission = new Map<string, DataRow[]>();
  for (const response of responses) {
    const submissionId = String(response.submission_id ?? "");
    const list = responseBySubmission.get(submissionId) ?? [];
    list.push(response);
    responseBySubmission.set(submissionId, list);
  }

  const submissionRows = submissions.map((submission): SubmissionRow => ({
    ...submission,
    responses: responseBySubmission.get(submission.id) ?? [],
  }));

  return {
    claims: claimRows,
    batches: batchRows,
    submissions: submissionRows,
  };
}

export async function getClaim360Data(claimId: string) {
  const claim = await repository.getClaim(claimId);
  if (!claim) throw new Error("Claim not found.");

  const [lines, diagnoses, history, submissions, responses, denials, appeals, workItems, encounters, clients, providers, payers] = await Promise.all([
    repository.getClaimLines(claimId),
    repository.getClaimDiagnoses(claimId),
    tenantSelect<DataRow>("claim_status_history", { claim_id: `eq.${claimId}`, order: "created_at.asc" }),
    tenantSelect<DataRow>("claim_submissions", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("submission_responses", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("denials", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("appeals", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", source_object_id: `eq.${claimId}`, order: "created_at.desc" }),
    claim.source_encounter_id
      ? tenantSelect<DataRow>("encounters", { id: `eq.${String(claim.source_encounter_id)}`, limit: "1" })
      : Promise.resolve([]),
    tenantSelect<DataRow>("clients", { id: `eq.${String(claim.client_id)}`, limit: "1" }),
    claim.rendering_provider_id
      ? tenantSelect<DataRow>("providers", { id: `eq.${String(claim.rendering_provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    claim.payer_id
      ? referenceSelect<DataRow>("payers", { id: `eq.${String(claim.payer_id)}`, limit: "1" })
      : Promise.resolve([]),
  ]);

  const enrichedClaim: EnrichedClaimRow = {
    ...claim,
    clientName: personName(first(clients) ?? undefined),
    providerName: personName(first(providers) ?? undefined),
    payerName: String(first(payers)?.name ?? "—"),
  };

  return {
    claim: enrichedClaim,
    sourceEncounter: first(encounters),
    lines,
    diagnoses,
    history,
    submissions,
    responses,
    denials,
    appeals,
    workItems,
  };
}
