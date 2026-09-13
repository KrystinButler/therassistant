import {
  blocked,
  failure,
  success,
  type WorkflowResult,
} from "../shared/workflow-result";

export type WorkRow = Record<string, any> & { id: string };

export type WorkCenterRepository = {
  getWorkItem(id: string): Promise<WorkRow | null>;
  updateWorkItem(id: string, values: Record<string, unknown>): Promise<WorkRow>;
  insertHistory(values: Record<string, unknown>): Promise<WorkRow>;
};

async function changeStatus(
  repo: WorkCenterRepository,
  id: string,
  newStatus: string,
  note?: string,
  extra: Record<string, unknown> = {},
): Promise<WorkflowResult<WorkRow>> {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");

  const oldStatus = String(item.workqueue_status ?? "open");
  if (oldStatus === newStatus && !Object.keys(extra).length) {
    return success(item);
  }

  try {
    const updated = await repo.updateWorkItem(id, {
      workqueue_status: newStatus,
      ...extra,
    });
    await repo.insertHistory({
      workqueue_item_id: id,
      old_status: oldStatus,
      new_status: newStatus,
      old_priority: item.priority || null,
      new_priority: updated.priority || item.priority || null,
      note: note || null,
    });
    return success(updated);
  } catch (error) {
    return failure(
      "work_update_failed",
      error instanceof Error ? error.message : "Unable to update work item.",
    );
  }
}

export async function startWork(
  repo: WorkCenterRepository,
  id: string,
  note = "Work started.",
) {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");
  if (["completed", "cancelled"].includes(String(item.workqueue_status))) {
    return blocked("work_closed", "Closed work must be reopened before it can be started.");
  }
  return changeStatus(repo, id, "in_progress", note);
}

export async function pendWork(
  repo: WorkCenterRepository,
  id: string,
  note: string,
  status: "pending" | "snoozed" = "pending",
) {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");
  if (["completed", "cancelled"].includes(String(item.workqueue_status))) {
    return blocked("work_closed", "Closed work must be reopened before it can be pended or snoozed.");
  }
  if (!note.trim()) return blocked("pending_reason_required", "A pending or snooze reason is required.");
  return changeStatus(repo, id, status, note.trim());
}

export async function changePriority(
  repo: WorkCenterRepository,
  id: string,
  priority: "low" | "normal" | "high" | "urgent",
  note = "Priority changed.",
): Promise<WorkflowResult<WorkRow>> {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");
  const oldPriority = String(item.priority ?? "normal");
  if (oldPriority === priority) return success(item);

  try {
    const updated = await repo.updateWorkItem(id, { priority });
    await repo.insertHistory({
      workqueue_item_id: id,
      old_status: item.workqueue_status || null,
      new_status: updated.workqueue_status || item.workqueue_status || null,
      old_priority: oldPriority,
      new_priority: priority,
      note,
    });
    return success(updated);
  } catch (error) {
    return failure(
      "priority_update_failed",
      error instanceof Error ? error.message : "Unable to change work priority.",
    );
  }
}

export async function completeWork(
  repo: WorkCenterRepository,
  id: string,
  note: string,
) {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");
  if (String(item.workqueue_status) === "cancelled") {
    return blocked("work_cancelled", "Cancelled work must be reopened before it can be completed.");
  }
  if (!note.trim()) return blocked("completion_note_required", "A completion note is required.");
  return changeStatus(repo, id, "completed", note.trim(), {
    completed_at: new Date().toISOString(),
  });
}

export async function reopenWork(
  repo: WorkCenterRepository,
  id: string,
  note: string,
) {
  const item = await repo.getWorkItem(id);
  if (!item) return failure("work_not_found", "Work item not found.");
  if (!["completed", "cancelled"].includes(String(item.workqueue_status))) {
    return blocked("work_not_closed", "Only completed or cancelled work can be reopened.");
  }
  if (!note.trim()) return blocked("reopen_reason_required", "A reopen reason is required.");
  return changeStatus(repo, id, "reopened", note.trim(), {
    completed_at: null,
    completed_by: null,
  });
}
