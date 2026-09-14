export type ClaimQueueRow = Record<string, unknown> & { id: string };

export type ClaimWorkqueues = {
  all: ClaimQueueRow[];
  validation: ClaimQueueRow[];
  submission: ClaimQueueRow[];
  rejections: ClaimQueueRow[];
  denials: ClaimQueueRow[];
  appeals: ClaimQueueRow[];
  paymentExceptions: ClaimQueueRow[];
};

export type BulkClaimAction =
  | "validate"
  | "create_follow_up"
  | "retry_rejected"
  | "mark_paid"
  | "resolve_denial";

const ACTIVE_APPEAL_STATUSES = ["not_started", "drafting", "submitted", "pending"];

export function isActiveAppealStatus(status: unknown) {
  return ACTIVE_APPEAL_STATUSES.includes(String(status ?? ""));
}

export function isRetryableRejection(claimStatus: unknown, latestResponseStatus: unknown) {
  const status = String(claimStatus ?? "");
  if (status === "rejected") return true;
  return ["submitted", "batched"].includes(status) && String(latestResponseStatus ?? "") === "rejected";
}

export function canBulkClaimAction(action: BulkClaimAction) {
  return ["validate", "create_follow_up", "retry_rejected"].includes(action);
}

export function buildClaimWorkqueues(
  claims: ClaimQueueRow[],
  responses: ClaimQueueRow[],
  denials: ClaimQueueRow[],
  payments: ClaimQueueRow[],
): ClaimWorkqueues {
  const latestResponseByClaim = new Map<string, ClaimQueueRow>();
  for (const response of responses) {
    const claimId = String(response.claim_id ?? "");
    if (claimId && !latestResponseByClaim.has(claimId)) {
      latestResponseByClaim.set(claimId, response);
    }
  }
  const claimsWithDenialRecord = new Set(
    denials.map((row) => String(row.claim_id ?? "")).filter(Boolean),
  );
  const deniedClaimIds = new Set(
    denials
      .filter((row) => !["resolved_paid", "resolved_writeoff", "upheld", "closed"].includes(String(row.denial_status ?? "")))
      .map((row) => String(row.claim_id ?? ""))
      .filter(Boolean),
  );
  const appealClaimIds = new Set(
    denials
      .filter((row) => row.denial_status === "appealed")
      .map((row) => String(row.claim_id ?? ""))
      .filter(Boolean),
  );
  const paymentClaimIds = new Set(
    payments
      .filter((row) => ["unapplied", "partially_applied"].includes(String(row.payment_status ?? "")))
      .map((row) => String(row.claim_id ?? ""))
      .filter(Boolean),
  );

  return {
    all: claims,
    validation: claims.filter((row) => ["ready_for_validation", "validation_failed"].includes(String(row.claim_status ?? ""))),
    submission: claims.filter((row) => ["ready_for_batch", "batched", "submitted"].includes(String(row.claim_status ?? ""))),
    rejections: claims.filter((row) => isRetryableRejection(
      row.claim_status,
      latestResponseByClaim.get(row.id)?.response_status,
    )),
    denials: claims.filter((row) => deniedClaimIds.has(row.id) || (row.claim_status === "denied" && !claimsWithDenialRecord.has(row.id))),
    appeals: claims.filter((row) => row.claim_status === "appealed" || appealClaimIds.has(row.id)),
    paymentExceptions: claims.filter((row) => paymentClaimIds.has(row.id)),
  };
}
