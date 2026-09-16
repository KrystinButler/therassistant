import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";

type DataRow = Row & { id: string };

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

export async function recordDenialFollowUp(
  denialId: string,
  note: string,
  referenceNumber: string,
  nextFollowUpDate: string,
) {
  const denial = (
    await demoSelect<DataRow>("denials", { id: `eq.${denialId}`, limit: "1" })
  )[0];
  if (!denial) throw new Error("Denial not found.");

  const current = await activeDenialWork(denialId);
  const metadata = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
    ? current.metadata as Record<string, unknown>
    : {};
  const values = {
    workqueue_type: "denial_followup",
    workqueue_status: "in_progress",
    priority: current?.priority ?? "high",
    source_object_type: "denial",
    source_object_id: denialId,
    title: `Denial follow-up${denial.carc_code ? ` · CARC ${String(denial.carc_code)}` : ""}`,
    description: note.trim() || String(current?.description ?? denial.reason ?? "Denial follow-up documented."),
    due_date: nextFollowUpDate || current?.due_date || denial.timely_filing_deadline || null,
    metadata: {
      ...metadata,
      payer_reference_number: referenceNumber.trim() || null,
      last_follow_up_at: new Date().toISOString(),
    },
  };

  const work = current
    ? await demoUpdate<DataRow>("workqueue_items", current.id, values)
    : await demoInsert<DataRow>("workqueue_items", values);

  await demoUpdate<DataRow>("denials", denialId, {
    denial_status: "reviewing",
    last_follow_up_at: new Date().toISOString(),
  });

  await demoInsert<DataRow>("workqueue_history", {
    workqueue_item_id: work.id,
    old_status: current?.workqueue_status ?? null,
    new_status: "in_progress",
    note: [
      note.trim() || "Denial follow-up documented.",
      referenceNumber.trim() ? `Payer reference: ${referenceNumber.trim()}.` : "",
      nextFollowUpDate ? `Next follow-up: ${nextFollowUpDate}.` : "",
    ].filter(Boolean).join(" "),
  });

  return work;
}
