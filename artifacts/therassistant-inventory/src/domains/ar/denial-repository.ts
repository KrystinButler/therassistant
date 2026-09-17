import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";
import { calculateOpenBalance } from "./aging";
import {
  assertAppealAllowed,
  capDenialWriteOffAmount,
  classifyDenialPolicy,
  createAppealInput,
} from "./denials";
import { isRecoveryAdjustment } from "./variance";

type DataRow = Row & { id: string };
const ACTIVE_APPEAL_STATUSES = ["not_started", "drafting", "submitted", "pending"];

async function first<T extends Row>(table: string, id: string) {
  return (await tenantSelect<T>(table, { id: `eq.${id}`, limit: "1" }))[0] ?? null;
}

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

async function getClaimFinancialState(claimId: string) {
  const claim = await first<DataRow>("professional_claims", claimId);
  if (!claim) throw new Error("Linked claim not found.");
  const [allocations, adjustments] = await Promise.all([
    tenantSelect<DataRow>("payment_allocations", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
  ]);
  const paidCents = total(allocations.filter((row) => !row.reversed_at), "amount_cents");
  const activeAdjustments = adjustments.filter(
    (row) => !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
  );
  const adjustmentCents = total(
    activeAdjustments.filter((row) => !isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  const recoveryCents = total(
    activeAdjustments.filter((row) => isRecoveryAdjustment(row.adjustment_type)),
    "amount_cents",
  );
  const openBalanceCents = calculateOpenBalance(
    Number(claim.total_charge_cents ?? 0),
    paidCents,
    adjustmentCents,
    recoveryCents,
  );
  return { claim, openBalanceCents };
}

async function addHistory(workItemId: string, note: string, oldStatus?: string, newStatus?: string) {
  return tenantInsert<DataRow>("workqueue_history", {
    workqueue_item_id: workItemId,
    old_status: oldStatus ?? null,
    new_status: newStatus ?? null,
    note,
  });
}

async function findActiveWork(sourceType: string, sourceId: string, workqueueType: string) {
  const rows = await tenantSelect<DataRow>("workqueue_items", {
    source_object_type: `eq.${sourceType}`,
    source_object_id: `eq.${sourceId}`,
    workqueue_type: `eq.${workqueueType}`,
    workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function startDenialWork(denialId: string) {
  const denial = await first<DataRow>("denials", denialId);
  if (!denial) throw new Error("Denial not found.");
  const policy = classifyDenialPolicy(denial.denial_category);
  if (policy === "auto_writeoff") {
    throw new Error("This denial follows the configured write-off policy. Use Write Off instead of appeal follow-up.");
  }

  await tenantUpdate<DataRow>("denials", denialId, {
    denial_status: "reviewing",
    workability: policy,
  });

  let work = await findActiveWork("denial", denialId, "denial_followup");
  if (!work) {
    work = await tenantInsert<DataRow>("workqueue_items", {
      workqueue_type: "denial_followup",
      workqueue_status: "in_progress",
      priority: "high",
      source_object_type: "denial",
      source_object_id: denialId,
      title: `Denial follow-up${denial.carc_code ? ` · CARC ${String(denial.carc_code)}` : ""}`,
      description: String(denial.reason ?? "Review denial and determine remediation."),
      due_date: denial.timely_filing_deadline ?? null,
    });
    await addHistory(work.id, "Denial work started from A/R workspace.", "open", "in_progress");
  } else if (work.workqueue_status !== "in_progress") {
    const oldStatus = String(work.workqueue_status ?? "open");
    await tenantUpdate<DataRow>("workqueue_items", work.id, { workqueue_status: "in_progress" });
    await addHistory(work.id, "Denial work resumed from A/R workspace.", oldStatus, "in_progress");
  }

  return work;
}

export async function createDenialAppeal(denialId: string, level: number, dueDate: string, notes: string) {
  const denial = await first<DataRow>("denials", denialId);
  if (!denial) throw new Error("Denial not found.");
  const activeAppeals = await tenantSelect<DataRow>("appeals", {
    denial_id: `eq.${denialId}`,
    appeal_status: `in.(${ACTIVE_APPEAL_STATUSES.join(",")})`,
    limit: "1",
  });
  assertAppealAllowed({ category: denial.denial_category, hasActiveAppeal: Boolean(activeAppeals[0]) });
  const draft = createAppealInput(denial, level, dueDate, notes);
  const appeal = await tenantInsert<DataRow>("appeals", {
    denial_id: draft.denial_id,
    claim_id: draft.claim_id,
    appeal_level: draft.appeal_level,
    appeal_status: draft.appeal_status,
    deadline_date: draft.deadline_date,
    notes: draft.notes,
  });

  await tenantUpdate<DataRow>("denials", denialId, { denial_status: "appealed", workability: "workable" });
  if (denial.claim_id) {
    await tenantUpdate<DataRow>("professional_claims", String(denial.claim_id), { claim_status: "appealed" });
  }

  const work = await tenantInsert<DataRow>("workqueue_items", {
    workqueue_type: "appeal_deadline",
    workqueue_status: "open",
    priority: "high",
    source_object_type: "appeal",
    source_object_id: appeal.id,
    title: `Appeal level ${level}${denial.carc_code ? ` · CARC ${String(denial.carc_code)}` : ""}`,
    description: "Prepare and submit payer appeal before the deadline.",
    due_date: dueDate || null,
  });
  await addHistory(work.id, "Appeal work item created from denial.", undefined, "open");
  return appeal;
}

export async function submitAppeal(appealId: string) {
  const appeal = await first<DataRow>("appeals", appealId);
  if (!appeal) throw new Error("Appeal not found.");
  if (!["not_started", "drafting"].includes(String(appeal.appeal_status))) {
    throw new Error("Only a not-started or drafting appeal can be submitted.");
  }
  return tenantUpdate<DataRow>("appeals", appealId, {
    appeal_status: "submitted",
    submitted_at: new Date().toISOString(),
  });
}

export async function recordAppealOutcome(appealId: string, outcome: "approved" | "partially_approved" | "denied" | "withdrawn") {
  const appeal = await first<DataRow>("appeals", appealId);
  if (!appeal) throw new Error("Appeal not found.");
  await tenantUpdate<DataRow>("appeals", appealId, { appeal_status: outcome, outcome });
  if (appeal.denial_id) {
    const denialStatus = outcome === "denied" ? "upheld" : outcome === "withdrawn" ? "closed" : "reviewing";
    await tenantUpdate<DataRow>("denials", String(appeal.denial_id), { denial_status: denialStatus });
  }
  const work = await findActiveWork("appeal", appealId, "appeal_deadline");
  if (work) {
    const oldStatus = String(work.workqueue_status ?? "open");
    await tenantUpdate<DataRow>("workqueue_items", work.id, {
      workqueue_status: "completed",
      completed_at: new Date().toISOString(),
    });
    await addHistory(work.id, `Appeal outcome recorded: ${outcome.replaceAll("_", " ")}.`, oldStatus, "completed");
  }
}

export async function writeOffDenial(denialId: string) {
  const denial = await first<DataRow>("denials", denialId);
  if (!denial) throw new Error("Denial not found.");
  if (classifyDenialPolicy(denial.denial_category) !== "auto_writeoff") {
    throw new Error("This denial is not configured for automatic write-off.");
  }
  const denialAmount = Number(denial.amount_cents ?? 0);
  if (denialAmount <= 0) throw new Error("A positive denial amount is required before write-off.");

  let writeOffAmount = denialAmount;
  let claimOpenBalance: number | null = null;
  if (denial.claim_id) {
    const financial = await getClaimFinancialState(String(denial.claim_id));
    claimOpenBalance = financial.openBalanceCents;
    writeOffAmount = capDenialWriteOffAmount(denialAmount, claimOpenBalance);
  }

  const type = denial.denial_category === "credentialing" ? "credentialing_writeoff" : "payer_writeoff";
  if (writeOffAmount > 0) {
    await tenantInsert<DataRow>("adjustments", {
      client_id: denial.client_id ?? null,
      claim_id: denial.claim_id ?? null,
      payer_id: denial.payer_id ?? null,
      adjustment_type: type,
      adjustment_status: "posted",
      amount_cents: writeOffAmount,
      reason: `Configured ${String(denial.denial_category)} denial write-off policy.`,
      carc_code: denial.carc_code ?? null,
      posted_at: new Date().toISOString(),
    });
  }
  await tenantUpdate<DataRow>("denials", denialId, {
    denial_status: "resolved_writeoff",
    workability: "auto_writeoff",
  });
  if (denial.claim_id && claimOpenBalance !== null) {
    const remainingBalance = Math.max(0, claimOpenBalance - writeOffAmount);
    if (remainingBalance === 0) {
      await tenantUpdate<DataRow>("professional_claims", String(denial.claim_id), { claim_status: "paid" });
    } else {
      await tenantUpdate<DataRow>("professional_claims", String(denial.claim_id), { claim_status: "partially_paid" });
    }
  }
  const work = await findActiveWork("denial", denialId, "denial_followup");
  if (work) {
    const oldStatus = String(work.workqueue_status ?? "open");
    await tenantUpdate<DataRow>("workqueue_items", work.id, { workqueue_status: "completed", completed_at: new Date().toISOString() });
    await addHistory(work.id, "Denial resolved through configured write-off policy.", oldStatus, "completed");
  }
}
