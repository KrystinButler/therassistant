import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";
import { getClaimsWorkspaceData, getClaimWorkData, type ClaimsWorkspaceRow } from "./workspace-repository";

type DataRow = Row & { id: string };

export type ClaimsQueueRow = ClaimsWorkspaceRow & {
  submittedAt: string | null;
  hasPayerResponse: boolean;
  deferred: boolean;
  hasActiveDenial: boolean;
};

const resolvedDenialStatuses = new Set(["resolved", "resolved_writeoff", "closed", "overturned", "withdrawn"]);

export async function getClaimsQueueData(): Promise<ClaimsQueueRow[]> {
  const data = await getClaimsWorkspaceData();
  return Promise.all(data.claims.map(async (claim) => {
    const work = await getClaimWorkData(claim.id);
    const activeDenial = (work?.denials ?? []).some(
      (row) => !resolvedDenialStatuses.has(String(row.denial_status ?? "").toLowerCase()),
    );
    const deferred = (work?.workItems ?? []).some(
      (row) =>
        row.workqueue_type === "claim_followup" &&
        ["pending", "snoozed"].includes(String(row.workqueue_status ?? "")),
    );
    const submittedHistory = (work?.history ?? []).find((row) =>
      ["submitted", "accepted"].includes(String(row.new_status ?? "")),
    );
    return {
      ...claim,
      submittedAt:
        claim.submitted_at
          ? String(claim.submitted_at)
          : submittedHistory?.created_at
            ? String(submittedHistory.created_at)
            : null,
      hasPayerResponse: Boolean(claim.payer_claim_number) || (work?.responses.length ?? 0) > 0,
      deferred,
      hasActiveDenial: activeDenial,
    };
  }));
}

async function activeFollowUp(claimId: string) {
  return (await demoSelect<DataRow>("workqueue_items", {
    source_object_type: "eq.claim",
    source_object_id: `eq.${claimId}`,
    workqueue_type: "eq.claim_followup",
    workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
    limit: "1",
  }))[0] ?? null;
}

export async function deferClaim(claimId: string, note: string) {
  const current = await activeFollowUp(claimId);
  const values = {
    workqueue_type: "claim_followup",
    workqueue_status: "pending",
    priority: "normal",
    source_object_type: "claim",
    source_object_id: claimId,
    title: "Claim follow-up deferred",
    description: note.trim() || "Deferred for later payer follow-up.",
  };
  const work = current
    ? await demoUpdate<DataRow>("workqueue_items", current.id, values)
    : await demoInsert<DataRow>("workqueue_items", values);
  await demoInsert<DataRow>("workqueue_history", {
    workqueue_item_id: work.id,
    old_status: current?.workqueue_status ?? null,
    new_status: "pending",
    note: note.trim() || "Claim deferred.",
  });
  return work;
}

export async function resumeClaim(claimId: string) {
  const current = await activeFollowUp(claimId);
  if (!current) return null;
  const oldStatus = String(current.workqueue_status ?? "pending");
  const work = await demoUpdate<DataRow>("workqueue_items", current.id, { workqueue_status: "in_progress" });
  await demoInsert<DataRow>("workqueue_history", {
    workqueue_item_id: work.id,
    old_status: oldStatus,
    new_status: "in_progress",
    note: "Claim returned to active payer follow-up.",
  });
  return work;
}

export { retryRejectedClaims } from "./workspace-repository";
