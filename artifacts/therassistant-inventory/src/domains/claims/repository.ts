import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import {
  recordExternalClaimAcknowledgementWorkflow,
  createBatchWorkflow,
  createClaimFromChargesWorkflow,
  recordExternalSubmissionWorkflow,
  validateClaimWorkflow,
  type ClaimCreationRepository,
  type ClaimsRepository,
} from "./workflow";

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

export function createClaimFromCharges(chargeIds: string[]) {
  return createClaimFromChargesWorkflow(claimCreationRepository, chargeIds);
}

export function validateClaim(claimId: string) {
  return validateClaimWorkflow(repository, claimId);
}

export function createBatch(claimIds: string[], batchName?: string) {
  return createBatchWorkflow(repository, claimIds, batchName);
}

export function recordExternalSubmission(
  batchId: string,
  externalReference: string,
  submissionMethod = "external_837p",
) {
  return recordExternalSubmissionWorkflow(
    repository,
    batchId,
    externalReference,
    submissionMethod,
  );
}

export function recordExternalClaimAcknowledgement(input: {
  submissionId: string;
  claimId: string;
  outcome: "accepted" | "rejected";
  acknowledgementType: "999" | "277CA" | "clearinghouse_portal" | "other";
  responseCode: string;
  responseMessage: string;
  externalReference: string;
}) {
  return recordExternalClaimAcknowledgementWorkflow(repository, input);
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
