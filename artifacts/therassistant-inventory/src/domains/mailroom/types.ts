export type CorrespondenceStatus =
  | "new"
  | "reviewed"
  | "action_required"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed";

export type CorrespondenceAction =
  | "review"
  | "require_action"
  | "start"
  | "pend"
  | "resolve"
  | "close"
  | "reopen";

export type CorrespondenceDueState = "none" | "current" | "due_soon" | "overdue";
export type CorrespondencePriority = "normal" | "high" | "urgent";

export type CorrespondenceActionDefinition = {
  action: CorrespondenceAction;
  label: string;
  nextStatus: CorrespondenceStatus;
};

export type MailroomFilterRow = {
  id: string;
  subject?: string | null;
  correspondenceType?: string | null;
  payerName?: string | null;
  patientName?: string | null;
  claimNumber?: string | null;
  providerName?: string | null;
  assigneeName?: string | null;
  assignedUserId?: string | null;
  status?: string | null;
  receivedDate?: string | null;
  dueDate?: string | null;
};
