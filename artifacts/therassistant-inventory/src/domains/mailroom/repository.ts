import {
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  getCurrentTenantId,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { storageClient } from "../../lib/storage-client";
import { correspondenceDueState } from "./workflow";
import type {
  ClassifyCorrespondenceInput,
  CorrespondenceAction,
  CreateCorrespondenceInput,
  MailroomInboxItem,
  MailroomReferenceData,
  MailroomRow,
} from "./types";

type DataRow = Row & { id: string };
type AssigneeRow = { user_id: string; display_label: string };

export type MailroomAggregateInput = {
  mailroomItems: DataRow[];
  clients: DataRow[];
  providers: DataRow[];
  payers: DataRow[];
  claims: DataRow[];
  authorizations: DataRow[];
  appeals: DataRow[];
  documents: DataRow[];
  statusHistory: DataRow[];
  workItems: DataRow[];
  assignees: AssigneeRow[];
  today?: Date;
};

export type CorrespondenceDocumentDependencies = {
  getTenantId(): Promise<string>;
  uploadMailroomFile(input: {
    tenantId: string;
    mailroomItemId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }): Promise<{ path: string }>;
  insertDocument(values: Row): Promise<DataRow>;
  linkDocument(id: string, documentId: string): Promise<MailroomRow>;
  deleteObject(path: string): Promise<void>;
};

function byId(rows: DataRow[]) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function personName(row?: DataRow, fallback = "Record unavailable") {
  if (!row) return fallback;
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || fallback;
}

function providerName(row?: DataRow) {
  if (!row) return "Provider record unavailable";
  const base = personName(row, "Provider record unavailable");
  const credentials = String(row.credentials ?? "").trim();
  return credentials ? `${base}, ${credentials}` : base;
}

function titleCase(value: unknown) {
  const text = String(value ?? "").replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function correspondenceWorkItems(rows: DataRow[], mailroomItemId: string) {
  return rows
    .filter((row) =>
      row.source_object_type === "mailroom_item" &&
      row.source_object_id === mailroomItemId &&
      row.workqueue_type === "correspondence",
    )
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

function activeCorrespondenceWork(rows: DataRow[], mailroomItemId: string) {
  return correspondenceWorkItems(rows, mailroomItemId).find(
    (row) => !["completed", "cancelled"].includes(String(row.workqueue_status ?? "")),
  ) ?? null;
}

export function buildMailroomAggregates(input: MailroomAggregateInput): MailroomInboxItem[] {
  const clients = byId(input.clients);
  const providers = byId(input.providers);
  const payers = byId(input.payers);
  const claims = byId(input.claims);
  const authorizations = byId(input.authorizations);
  const appeals = byId(input.appeals);
  const documents = byId(input.documents);
  const assignees = new Map(input.assignees.map((row) => [row.user_id, row.display_label]));
  const today = input.today ?? new Date();

  return input.mailroomItems.map((raw) => {
    const item = raw as MailroomRow;
    const clientId = item.client_id ?? null;
    const providerId = item.provider_id ?? null;
    const payerId = item.payer_id ?? null;
    const claimId = item.claim_id ?? null;
    const authorizationId = item.authorization_id ?? null;
    const appealId = item.appeal_id ?? null;
    const documentId = item.document_id ?? null;
    const assignedUserId = item.assigned_user_id ?? null;

    const client = clientId ? clients.get(clientId) : undefined;
    const provider = providerId ? providers.get(providerId) : undefined;
    const payer = payerId ? payers.get(payerId) : undefined;
    const claim = claimId ? claims.get(claimId) : undefined;
    const authorization = authorizationId ? authorizations.get(authorizationId) : undefined;
    const appeal = appealId ? appeals.get(appealId) : undefined;
    const document = documentId ? documents.get(documentId) ?? null : null;

    const history = input.statusHistory
      .filter((row) => row.target_type === "mailroom_item" && row.target_id === item.id)
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

    const appealLevel = appeal ? titleCase(appeal.appeal_level) : "";
    const appealStatus = appeal ? String(appeal.appeal_status ?? "").replaceAll("_", " ") : "";
    const work = correspondenceWorkItems(input.workItems, item.id);

    return {
      ...item,
      correspondenceType: item.correspondence_type,
      receivedDate: item.received_date,
      dueDate: item.due_date ?? null,
      assignedUserId,
      patientName: clientId ? personName(client, "Patient record unavailable") : "—",
      providerName: providerId ? providerName(provider) : "—",
      payerName: payerId ? String(payer?.name ?? "Payer record unavailable") : "—",
      claimNumber: claimId
        ? String(claim?.patient_control_number ?? claim?.payer_claim_number ?? "Claim record unavailable")
        : "—",
      payerClaimNumber: claim ? String(claim.payer_claim_number ?? "—") : claimId ? "Claim record unavailable" : "—",
      authorizationNumber: authorizationId
        ? String(authorization?.authorization_number ?? "Authorization record unavailable")
        : "—",
      appealLabel: appealId
        ? appeal
          ? `${appealLevel || "Appeal"}${appealLevel ? " appeal" : ""} · ${appealStatus || "status unavailable"}`
          : "Appeal record unavailable"
        : "—",
      assigneeName: assignedUserId ? assignees.get(assignedUserId) ?? "Assignee unavailable" : "—",
      dueState: correspondenceDueState(item.due_date, today),
      document,
      documentMissing: Boolean(documentId && !document),
      activeWork: activeCorrespondenceWork(input.workItems, item.id),
      correspondenceWork: work,
      statusHistory: history,
    } as MailroomInboxItem;
  });
}

export function findCorrespondenceDetail(rows: MailroomInboxItem[], id: string) {
  return rows.find((row) => row.id === id) ?? null;
}

async function loadReferenceRows(): Promise<MailroomReferenceData> {
  const [clients, providers, payers, claims, authorizations, appeals, documents, assignees] = await Promise.all([
    tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    tenantSelect<DataRow>("authorizations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("appeals", { order: "created_at.desc" }),
    tenantSelect<DataRow>("documents", { order: "created_at.desc" }),
    tenantRpc<AssigneeRow[]>("get_demo_mailroom_assignees"),
  ]);

  return { clients, providers, payers, claims, authorizations, appeals, documents, assignees };
}

async function loadAggregateInput() {
  const [mailroomItems, referenceData, statusHistory, workItems] = await Promise.all([
    tenantSelect<DataRow>("mailroom_items", { order: "received_date.desc,created_at.desc" }),
    loadReferenceRows(),
    tenantSelect<DataRow>("status_history", { target_type: "eq.mailroom_item", order: "created_at.asc" }),
    tenantSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.mailroom_item",
      workqueue_type: "eq.correspondence",
      order: "created_at.desc",
    }),
  ]);

  return {
    mailroomItems,
    ...referenceData,
    statusHistory,
    workItems,
  } satisfies MailroomAggregateInput;
}

export async function getMailroomInbox() {
  return buildMailroomAggregates(await loadAggregateInput());
}

export async function getCorrespondenceDetail(id: string) {
  return findCorrespondenceDetail(await getMailroomInbox(), id);
}

export function getMailroomReferenceData() {
  return loadReferenceRows();
}

export function createCorrespondence(input: CreateCorrespondenceInput) {
  return tenantInsert<MailroomRow>("mailroom_items", {
    subject: input.subject,
    received_date: input.receivedDate,
    correspondence_type: input.correspondenceType,
    payer_id: input.payerId ?? null,
    client_id: input.clientId ?? null,
    claim_id: input.claimId ?? null,
    provider_id: input.providerId ?? null,
    authorization_id: input.authorizationId ?? null,
    appeal_id: input.appealId ?? null,
    document_id: input.documentId ?? null,
    assigned_user_id: input.assignedUserId ?? null,
    due_date: input.dueDate ?? null,
    notes: input.notes ?? null,
    status: "new",
  });
}

export function classifyCorrespondence(id: string, input: ClassifyCorrespondenceInput) {
  const values: Row = {};
  if (input.subject !== undefined) values.subject = input.subject;
  if (input.correspondenceType !== undefined) values.correspondence_type = input.correspondenceType;
  if (input.payerId !== undefined) values.payer_id = input.payerId;
  if (input.clientId !== undefined) values.client_id = input.clientId;
  if (input.claimId !== undefined) values.claim_id = input.claimId;
  if (input.providerId !== undefined) values.provider_id = input.providerId;
  if (input.authorizationId !== undefined) values.authorization_id = input.authorizationId;
  if (input.appealId !== undefined) values.appeal_id = input.appealId;
  if (input.assignedUserId !== undefined) values.assigned_user_id = input.assignedUserId;
  if (input.dueDate !== undefined) values.due_date = input.dueDate;
  if (input.notes !== undefined) values.notes = input.notes;
  return tenantUpdate<MailroomRow>("mailroom_items", id, values);
}

export function transitionCorrespondence(
  id: string,
  action: CorrespondenceAction,
  reason?: string,
) {
  return tenantRpc<MailroomRow>("transition_demo_mailroom_item", {
    p_mailroom_item_id: id,
    p_action: action,
    p_reason: reason ?? null,
  });
}

export function linkCorrespondenceDocument(id: string, documentId: string) {
  return tenantUpdate<MailroomRow>("mailroom_items", id, { document_id: documentId });
}

export function documentTypeForCorrespondence(correspondenceType: string) {
  if (correspondenceType === "eob") return "eob";
  if (["appeal", "reconsideration"].includes(correspondenceType)) return "appeal_letter";
  if (correspondenceType === "prior_authorization_notice") return "authorization_letter";
  return "payer_correspondence";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function addCorrespondenceDocumentWithDependencies(
  correspondence: MailroomRow,
  file: File,
  deps: CorrespondenceDocumentDependencies,
) {
  const tenantId = await deps.getTenantId();
  const uploaded = await deps.uploadMailroomFile({
    tenantId,
    mailroomItemId: correspondence.id,
    file,
    fileName: file.name,
    contentType: file.type || undefined,
  });

  let document: DataRow;
  try {
    document = await deps.insertDocument({
      client_id: correspondence.client_id ?? null,
      claim_id: correspondence.claim_id ?? null,
      authorization_id: correspondence.authorization_id ?? null,
      appeal_id: correspondence.appeal_id ?? null,
      document_type: documentTypeForCorrespondence(correspondence.correspondence_type),
      document_status: "uploaded",
      file_name: file.name,
      storage_path: uploaded.path,
      mime_type: file.type || null,
      file_size_bytes: file.size,
    });
  } catch (error) {
    try {
      await deps.deleteObject(uploaded.path);
    } catch (cleanupError) {
      throw new Error(`${errorText(error)} Storage cleanup also failed: ${errorText(cleanupError)}`);
    }
    throw error;
  }

  try {
    return await deps.linkDocument(correspondence.id, document.id);
  } catch (error) {
    throw new Error(
      `The document was saved but could not be linked to this correspondence. It can be linked from existing documents. ${errorText(error)}`,
    );
  }
}

export function addCorrespondenceDocument(correspondence: MailroomRow, file: File) {
  return addCorrespondenceDocumentWithDependencies(correspondence, file, {
    getTenantId: getCurrentTenantId,
    uploadMailroomFile: storageClient.uploadMailroomFile,
    insertDocument: (values) => tenantInsert<DataRow>("documents", values),
    linkDocument: linkCorrespondenceDocument,
    deleteObject: storageClient.deleteObject,
  });
}

export function openCorrespondenceDocument(storagePath: string, expiresIn = 300) {
  return storageClient.createSignedDocumentUrl(storagePath, expiresIn);
}
