import type {
  CorrespondenceActionDefinition,
  CorrespondenceDueState,
  CorrespondencePriority,
  CorrespondenceStatus,
  MailroomFilterRow,
} from "./types.ts";

const actionsByStatus: Record<CorrespondenceStatus, CorrespondenceActionDefinition[]> = {
  new: [
    { action: "review", label: "Mark Reviewed", nextStatus: "reviewed" },
    { action: "require_action", label: "Action Required", nextStatus: "action_required" },
    { action: "close", label: "Close", nextStatus: "closed" },
  ],
  reviewed: [
    { action: "require_action", label: "Action Required", nextStatus: "action_required" },
    { action: "close", label: "Close", nextStatus: "closed" },
  ],
  action_required: [
    { action: "start", label: "Start Work", nextStatus: "in_progress" },
    { action: "pend", label: "Pend", nextStatus: "pending" },
    { action: "resolve", label: "Resolve", nextStatus: "resolved" },
  ],
  in_progress: [
    { action: "pend", label: "Pend", nextStatus: "pending" },
    { action: "resolve", label: "Resolve", nextStatus: "resolved" },
  ],
  pending: [
    { action: "start", label: "Resume Work", nextStatus: "in_progress" },
    { action: "resolve", label: "Resolve", nextStatus: "resolved" },
  ],
  resolved: [
    { action: "close", label: "Close", nextStatus: "closed" },
    { action: "reopen", label: "Reopen", nextStatus: "action_required" },
  ],
  closed: [
    { action: "reopen", label: "Reopen", nextStatus: "action_required" },
  ],
};

export function availableCorrespondenceActions(status: CorrespondenceStatus) {
  return actionsByStatus[status] ?? [];
}

export function isCorrespondenceTransitionAllowed(
  currentStatus: CorrespondenceStatus,
  nextStatus: CorrespondenceStatus,
) {
  return availableCorrespondenceActions(currentStatus).some(
    (action) => action.nextStatus === nextStatus,
  );
}

function startOfUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function correspondenceDueState(
  dueDate: string | null | undefined,
  today = new Date(),
): CorrespondenceDueState {
  if (!dueDate) return "none";
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return "none";
  const daysUntilDue = Math.floor((due - startOfUtcDay(today)) / 86_400_000);
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 7) return "due_soon";
  return "current";
}

export function correspondencePriority(
  dueDate: string | null | undefined,
  today = new Date(),
): CorrespondencePriority {
  const state = correspondenceDueState(dueDate, today);
  if (state === "overdue") return "urgent";
  if (state === "due_soon") return "high";
  return "normal";
}

export function buildCorrespondenceWorkItem(input: {
  tenantId: string;
  mailroomItemId: string;
  subject: string;
  correspondenceType: string;
  dueDate?: string | null;
  today?: Date;
}) {
  return {
    tenant_id: input.tenantId,
    workqueue_type: "correspondence",
    workqueue_status: "open",
    priority: correspondencePriority(input.dueDate, input.today),
    source_object_type: "mailroom_item",
    source_object_id: input.mailroomItemId,
    title: input.subject,
    description: `${input.correspondenceType.replaceAll("_", " ")} correspondence requires follow-up.`,
    due_date: input.dueDate ?? null,
  };
}

export function buildCorrespondenceHistory(input: {
  tenantId: string;
  mailroomItemId: string;
  oldStatus: CorrespondenceStatus;
  newStatus: CorrespondenceStatus;
  reason?: string | null;
}) {
  return {
    tenant_id: input.tenantId,
    target_type: "mailroom_item",
    target_id: input.mailroomItemId,
    old_status: input.oldStatus,
    new_status: input.newStatus,
    reason: input.reason ?? null,
  };
}

export type MailroomFilterOptions = {
  search?: string;
  status?: string;
  correspondenceType?: string;
  payerName?: string;
  assignedUserId?: string | null;
  dueState?: CorrespondenceDueState;
  sort?: "newest" | "oldest" | "due";
  today?: Date;
};

export function filterAndSortMailroomItems<T extends MailroomFilterRow>(
  rows: T[],
  options: MailroomFilterOptions = {},
): T[] {
  const term = options.search?.trim().toLowerCase() ?? "";
  const today = options.today ?? new Date();

  const filtered = rows.filter((row) => {
    if (options.status && row.status !== options.status) return false;
    if (options.correspondenceType && row.correspondenceType !== options.correspondenceType) return false;
    if (options.payerName && row.payerName !== options.payerName) return false;
    if (options.assignedUserId !== undefined && row.assignedUserId !== options.assignedUserId) return false;
    if (options.dueState && correspondenceDueState(row.dueDate, today) !== options.dueState) return false;
    if (term) {
      const haystack = [
        row.subject,
        row.patientName,
        row.claimNumber,
        row.payerName,
        row.providerName,
        row.assigneeName,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const sort = options.sort ?? "newest";
  return [...filtered].sort((a, b) => {
    if (sort === "due") {
      const aDue = a.dueDate ? Date.parse(`${a.dueDate}T00:00:00Z`) : Number.POSITIVE_INFINITY;
      const bDue = b.dueDate ? Date.parse(`${b.dueDate}T00:00:00Z`) : Number.POSITIVE_INFINITY;
      return aDue - bDue || String(b.receivedDate ?? "").localeCompare(String(a.receivedDate ?? ""));
    }
    const comparison = String(a.receivedDate ?? "").localeCompare(String(b.receivedDate ?? ""));
    return sort === "oldest" ? comparison : -comparison;
  });
}
