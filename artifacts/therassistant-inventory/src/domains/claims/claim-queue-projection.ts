import type { Row } from "../../lib/tenant-data-client";
import type { ClaimsWorkspaceRow } from "./workspace-repository";

export type ProjectedClaimQueueRow = ClaimsWorkspaceRow & {
  submittedAt: string | null;
  hasPayerResponse: boolean;
  deferred: boolean;
  hasActiveDenial: boolean;
};

const resolvedDenialStatuses = new Set(["resolved", "resolved_writeoff", "closed", "overturned", "withdrawn"]);

/** Derive queue states from tenant-scoped batch reads instead of issuing 8 requests per claim. */
export function projectClaimQueueRows(input: {
  claims: ClaimsWorkspaceRow[];
  responses: Row[];
  denials: Row[];
  workItems: Row[];
  history: Row[];
}): ProjectedClaimQueueRow[] {
  const firstResponseByClaim = new Map<string, Row>();
  const denialsByClaim = new Map<string, Row[]>();
  const deferredClaims = new Set<string>();
  const firstSubmittedHistoryByClaim = new Map<string, Row>();

  // The repositories order responses and history newest first.
  for (const response of input.responses) {
    const claimId = String(response.claim_id ?? "");
    if (claimId && !firstResponseByClaim.has(claimId)) firstResponseByClaim.set(claimId, response);
  }
  for (const denial of input.denials) {
    const claimId = String(denial.claim_id ?? "");
    if (!claimId) continue;
    const existing = denialsByClaim.get(claimId) ?? [];
    existing.push(denial);
    denialsByClaim.set(claimId, existing);
  }
  for (const workItem of input.workItems) {
    if (
      workItem.workqueue_type === "claim_followup" &&
      ["pending", "snoozed"].includes(String(workItem.workqueue_status ?? ""))
    ) deferredClaims.add(String(workItem.source_object_id ?? ""));
  }
  for (const event of input.history) {
    const claimId = String(event.claim_id ?? "");
    if (
      claimId && !firstSubmittedHistoryByClaim.has(claimId) &&
      ["submitted", "accepted"].includes(String(event.new_status ?? ""))
    ) firstSubmittedHistoryByClaim.set(claimId, event);
  }

  return input.claims.map((claim) => {
    const activeDenial = (denialsByClaim.get(claim.id) ?? []).some(
      (row) => !resolvedDenialStatuses.has(String(row.denial_status ?? "").toLowerCase()),
    );
    const submittedHistory = firstSubmittedHistoryByClaim.get(claim.id);
    const submittedAt = claim.submitted_at
      ? String(claim.submitted_at)
      : submittedHistory?.created_at
        ? String(submittedHistory.created_at)
        : null;
    const latestResponse = firstResponseByClaim.get(claim.id);
    const responseAt = latestResponse?.created_at ? String(latestResponse.created_at) : null;
    const responseIsCurrent = Boolean(latestResponse) && (
      !submittedAt ||
      !responseAt ||
      new Date(responseAt).getTime() >= new Date(submittedAt).getTime()
    );
    return {
      ...claim,
      clearinghouseStatus: responseIsCurrent ? String(latestResponse?.response_status ?? "—") : "—",
      submittedAt,
      hasPayerResponse: latestResponse ? responseIsCurrent : Boolean(claim.payer_claim_number),
      deferred: deferredClaims.has(claim.id),
      hasActiveDenial: activeDenial,
    };
  });
}
