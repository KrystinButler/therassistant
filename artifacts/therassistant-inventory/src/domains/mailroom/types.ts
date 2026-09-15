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

export type MailroomRow = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  subject: string;
  correspondence_type: string;
  received_date: string;
  status: CorrespondenceStatus;
  payer_id?: string | null;
  claim_id?: string | null;
  client_id?: string | null;
  provider_id?: string | null;
  authorization_id?: string | null;
  appeal_id?: string | null;
  document_id?: string | null;
  assigned_user_id?: string | null;
  due_date?: string | null;
  notes?: string | null;
};

export type MailroomInboxItem = MailroomRow & MailroomFilterRow & {
  correspondenceType: string;
  receivedDate: string;
  dueDate: string | null;
  assignedUserId: string | null;
  payerName: string;
  patientName: string;
  providerName: string;
  claimNumber: string;
  payerClaimNumber: string;
  authorizationNumber: string;
  appealLabel: string;
  assigneeName: string;
  dueState: CorrespondenceDueState;
  document: Record<string, unknown> | null;
  documentMissing: boolean;
  activeWork: Record<string, unknown> | null;
  correspondenceWork: Array<Record<string, unknown> & { id: string }>;
  statusHistory: Array<Record<string, unknown> & { id: string }>;
};

export type CreateCorrespondenceInput = {
  subject: string;
  receivedDate: string;
  correspondenceType: string;
  payerId?: string | null;
  clientId?: string | null;
  claimId?: string | null;
  providerId?: string | null;
  authorizationId?: string | null;
  appealId?: string | null;
  documentId?: string | null;
  assignedUserId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export type ClassifyCorrespondenceInput = {
  subject?: string;
  correspondenceType?: string;
  payerId?: string | null;
  clientId?: string | null;
  claimId?: string | null;
  providerId?: string | null;
  authorizationId?: string | null;
  appealId?: string | null;
  assignedUserId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export type MailroomReferenceData = {
  clients: Array<Record<string, unknown> & { id: string }>;
  providers: Array<Record<string, unknown> & { id: string }>;
  payers: Array<Record<string, unknown> & { id: string }>;
  claims: Array<Record<string, unknown> & { id: string }>;
  authorizations: Array<Record<string, unknown> & { id: string }>;
  appeals: Array<Record<string, unknown> & { id: string }>;
  documents: Array<Record<string, unknown> & { id: string }>;
  assignees: Array<{ user_id: string; display_label: string }>;
};
