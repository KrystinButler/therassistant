import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";

type DataRow = Row & { id: string };

export type DenialFollowUpInput = {
  payerReferenceNumber: string;
  nextFollowUpDate: string;
  actionTaken: string;
  notes: string;
};

async function activeDenialWork(denialId: string) {
  return (
    await demoSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.denial",
      source_object_id: `eq.${denialId}`,
      workqueue_type: "eq.denial_followup",
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    })
  )[0] ?? null;
}

export async function saveDenialFollowUp(denialId: string, input: DenialFollowUpInput) {
  const denial = (
    await demoSelect<DataRow>("denials", { id: `eq.${denialId}`, limit: "1" })
  )[0];
  if (!denial) throw new Error("Denial not found.");
  if (!input.actionTaken.trim() && !input.notes.trim()) {
    throw new Error("Record the action taken or a follow-up note.");
  }

  let work = await activeDenialWork(denialId);
  const oldStatus = String(work?.workqueue_status ?? "open");
  const description = input.actionTaken.trim() || String(denial.reason ?? "Denial follow-up");
  if (work) {
    work = await demoUpdate<DataRow>("workqueue_items", work.id, {
      workqueue_status: "in_progress",
      due_date: input.nextFollowUpDate || null,
      description,
    });
  } else {
    work = await demoInsert<DataRow>("workqueue_items", {
      workqueue_type: "denial_followup",
      workqueue_status: "in_progress",
      priority: "high",
      source_object_type: "denial",
      source_object_id: denialId,
      title: `Denial follow-up${denial.carc_code ? ` · CARC ${String(denial.carc_code)}` : ""}`,
      description,
      due_date: input.nextFollowUpDate || null,
    });
  }

  const detail = [
    input.actionTaken.trim() ? `Action: ${input.actionTaken.trim()}` : "",
    input.payerReferenceNumber.trim() ? `Payer reference: ${input.payerReferenceNumber.trim()}` : "",
    input.nextFollowUpDate ? `Next follow-up: ${input.nextFollowUpDate}` : "",
    input.notes.trim() ? `Notes: ${input.notes.trim()}` : "",
  ].filter(Boolean).join(" | ");

  await demoInsert<DataRow>("workqueue_history", {
    workqueue_item_id: work.id,
    old_status: oldStatus,
    new_status: "in_progress",
    note: detail,
  });

  await demoUpdate<DataRow>("denials", denialId, {
    denial_status: "reviewing",
    notes: input.notes.trim() || denial.notes || null,
  });

  return work;
}
