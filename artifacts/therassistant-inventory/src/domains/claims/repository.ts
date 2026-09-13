import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import {
  applySyntheticClearinghouseResponseWorkflow,
  createBatchWorkflow,
  createClaimFromChargesWorkflow,
  submitBatchWorkflow,
  validateClaimWorkflow,
  type ClaimCreationRepository,
  type ClaimsRepository,
} from "./workflow";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

const claimCreationRepository: ClaimCreationRepository = {
  getCharges(chargeIds) {
    return demoSelect<DataRow>("charge_capture_items", {
      id: inFilter(chargeIds),
      order: "service_date.asc",
    });
  },
  createClaim(values) {
    return demoInsert<DataRow>("professional_claims", values);
  },
  createClaimLine(values) {
    return demoInsert<DataRow>("professional_claim_lines", values);
  },
  createClaimDiagnosis(values) {
    return demoInsert<DataRow>("claim_diagnoses", values);
  },
  updateCharge(id, values) {
    return demoUpdate<DataRow>("charge_capture_items", id, values);
  },
  updateEncounter(id, values) {
    return demoUpdate<DataRow>("encounters", id, values);
  },
};

const repository: ClaimsRepository = {
  async getClaim(claimId) {
    return first(
      await demoSelect<DataRow>("professional_claims", {
        id: `eq.${claimId}`,
        limit: "1",
      }),
    );
  },

  getClaimLines(claimId) {
    return demoSelect<DataRow>("professional_claim_lines", {
      claim_id: `eq.${claimId}`,
      order: "service_date.asc,created_at.asc",
    });
  },

  getClaimDiagnoses(claimId) {
    return demoSelect<DataRow>("claim_diagnoses", {
      claim_id: `eq.${claimId}`,
      order: "pointer_order.asc",
    });
  },

  async getProviderEnrollmentStatus(claim) {
    if (!claim.rendering_provider_id || !claim.payer_id) return null;
    const enrollment = first(
      await demoSelect<DataRow>("provider_payer_enrollments", {
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
      await demoSelect<DataRow>("encounters", {
        id: `eq.${String(claim.source_encounter_id)}`,
        limit: "1",
      }),
    );
    return encounter ? String(encounter.billing_status ?? "not_ready") : null;
  },

  updateClaim(id, values) {
    return demoUpdate<DataRow>("professional_claims", id, values);
  },

  insertClaimHistory(values) {
    return demoInsert<DataRow>("claim_status_history", values);
  },

  createBatch(values) {
    return demoInsert<DataRow>("claim_batches", values);
  },

  addClaimToBatch(values) {
    return demoInsert<DataRow>("claim_batch_items", values);
  },

  async getBatch(batchId) {
    return first(
      await demoSelect<DataRow>("claim_batches", {
        id: `eq.${batchId}`,
        limit: "1",
      }),
    );
  },

  async getBatchClaims(batchId) {
    const items = await demoSelect<DataRow>("claim_batch_items", {
      batch_id: `eq.${batchId}`,
      order: "created_at.asc",
    });
    const claimIds = items.map((item) => String(item.claim_id ?? "")).filter(Boolean);
    if (!claimIds.length) return [];
    return demoSelect<DataRow>("professional_claims", {
      id: inFilter(claimIds),
      order: "service_date_from.asc",
    });
  },

  updateBatch(id, values) {
    return demoUpdate<DataRow>("claim_batches", id, values);
  },

  createSubmission(values) {
    return demoInsert<DataRow>("claim_submissions", values);
  },

  async getSubmission(submissionId) {
    return first(
      await demoSelect<DataRow>("claim_submissions", {
        id: `eq.${submissionId}`,
        limit: "1",
      }),
    );
  },

  updateSubmission(id, values) {
    return demoUpdate<DataRow>("claim_submissions", id, values);
  },

  createSubmissionResponse(values) {
    return demoInsert<DataRow>("submission_responses", values);
  },

  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await demoSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.claim",
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return demoUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return demoInsert<DataRow>("workqueue_items", values);
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

export function submitBatch(batchId: string) {
  return submitBatchWorkflow(repository, batchId);
}

export function applySyntheticClearinghouseResponse(
  submissionId: string,
  outcome: "accepted" | "rejected",
  responseCode?: string,
  responseMessage?: string,
) {
  return applySyntheticClearinghouseResponseWorkflow(
    repository,
    submissionId,
    outcome,
    responseCode,
    responseMessage,
  );
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export async function getClaimSubmissionData() {
  const [claims, clients, providers, payers, batches, batchItems, submissions, responses] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("clients"),
    demoSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("claim_batches", { order: "created_at.desc" }),
    demoSelect<DataRow>("claim_batch_items", { order: "created_at.desc" }),
    demoSelect<DataRow>("claim_submissions", { order: "created_at.desc" }),
    demoSelect<DataRow>("submission_responses", { order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const claimRows = claims.map((claim) => ({
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

  const batchRows = batches.map((batch) => ({
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

  const submissionRows = submissions.map((submission) => ({
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
    demoSelect<DataRow>("claim_status_history", { claim_id: `eq.${claimId}`, order: "created_at.asc" }),
    demoSelect<DataRow>("claim_submissions", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("submission_responses", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("denials", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("appeals", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("workqueue_items", { source_object_type: "eq.claim", source_object_id: `eq.${claimId}`, order: "created_at.desc" }),
    claim.source_encounter_id
      ? demoSelect<DataRow>("encounters", { id: `eq.${String(claim.source_encounter_id)}`, limit: "1" })
      : Promise.resolve([]),
    demoSelect<DataRow>("clients", { id: `eq.${String(claim.client_id)}`, limit: "1" }),
    claim.rendering_provider_id
      ? demoSelect<DataRow>("providers", { id: `eq.${String(claim.rendering_provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    claim.payer_id
      ? referenceSelect<DataRow>("payers", { id: `eq.${String(claim.payer_id)}`, limit: "1" })
      : Promise.resolve([]),
  ]);

  return {
    claim: {
      ...claim,
      clientName: personName(first(clients) ?? undefined),
      providerName: personName(first(providers) ?? undefined),
      payerName: String(first(payers)?.name ?? "—"),
    },
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
