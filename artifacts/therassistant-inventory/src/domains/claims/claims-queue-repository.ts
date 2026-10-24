import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { getClaimsWorkspaceData } from "./workspace-repository";
import { projectClaimQueueRows, type ProjectedClaimQueueRow } from "./claim-queue-projection";

type DataRow = Row & { id: string };
export type ClaimsQueueRow = ProjectedClaimQueueRow;

export async function getClaimsQueueData(): Promise<ClaimsQueueRow[]> {
  // All reads remain tenant-scoped. A single history request replaces one per claim.
  const [data, history] = await Promise.all([
    getClaimsWorkspaceData(),
    tenantSelect<DataRow>("claim_status_history", {
      new_status: "in.(submitted,accepted)",
      order: "created_at.desc",
    }),
  ]);
  return projectClaimQueueRows({
    claims: data.claims,
    responses: data.responses,
    denials: data.denials,
    workItems: data.workItems,
    history,
  });
}

async function activeFollowUp(claimId: string) {
  return (await tenantSelect<DataRow>("workqueue_items", {
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
    ? await tenantUpdate<DataRow>("workqueue_items", current.id, values)
    : await tenantInsert<DataRow>("workqueue_items", values);
  await tenantInsert<DataRow>("workqueue_history", {
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
  const work = await tenantUpdate<DataRow>("workqueue_items", current.id, { workqueue_status: "in_progress" });
  await tenantInsert<DataRow>("workqueue_history", {
    workqueue_item_id: work.id,
    old_status: oldStatus,
    new_status: "in_progress",
    note: "Claim returned to active payer follow-up.",
  });
  return work;
}
