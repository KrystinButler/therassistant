import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  jsonb,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { providersTable } from "./providers";
import { payersTable } from "./payers";
import { professionalClaimsTable, appealsTable } from "./claims";
import { authorizationsTable } from "./readiness";
import { appointmentsTable } from "./clinical";
import { documentStatusEnum, documentTypeEnum, noteTypeEnum, noteVisibilityEnum } from "./enums";

export const accountNotesTable = pgTable("account_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  noteType: noteTypeEnum("note_type").notNull().default("account"),
  visibility: noteVisibilityEnum("visibility").notNull().default("internal"),
  noteText: text("note_text").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  oldValues: jsonb("old_values").$type<Record<string, unknown>>(),
  newValues: jsonb("new_values").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const statusHistoryTable = pgTable("status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedBy: uuid("changed_by"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemEventsTable = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id),
  eventType: text("event_type").notNull(),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phiAccessLogsTable = pgTable("phi_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id),
  clientId: uuid("client_id").references(() => clientsTable.id),
  userId: uuid("user_id"),
  accessReason: text("access_reason"),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id),
  userId: uuid("user_id"),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  readAt: timestamp("read_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentsTable = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  authorizationId: uuid("authorization_id").references(() => authorizationsTable.id),
  appealId: uuid("appeal_id").references(() => appealsTable.id),
  documentType: documentTypeEnum("document_type").notNull().default("other"),
  documentStatus: documentStatusEnum("document_status").notNull().default("uploaded"),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importBatchesTable = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  importName: text("import_name").notNull(),
  importStatus: text("import_status").notNull().default("uploaded"),
  sourceSystem: text("source_system"),
  importType: text("import_type").notNull().default("patients"),
  sourceFileHash: text("source_file_hash"),
  mappingProfile: jsonb("mapping_profile").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastProcessedRow: integer("last_processed_row").notNull().default(0),
  reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>().notNull().default({}),
  rollbackStatus: text("rollback_status").notNull().default("not_requested"),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importRowsTable = pgTable("import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatchesTable.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull(),
  mappedData: jsonb("mapped_data").$type<Record<string, unknown>>(),
  rowStatus: text("row_status").notNull().default("pending"),
  sourceKey: text("source_key"),
  rowFingerprint: text("row_fingerprint"),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  attemptCount: integer("attempt_count").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  rollbackStatus: text("rollback_status").notNull().default("not_requested"),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  rollbackError: text("rollback_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importValidationErrorsTable = pgTable("import_validation_errors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatchesTable.id, { onDelete: "cascade" }),
  importRowId: uuid("import_row_id").references(() => importRowsTable.id),
  severity: text("severity").notNull().default("error"),
  fieldName: text("field_name"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mailroomItemsTable = pgTable("mailroom_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").references(() => payersTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  subject: text("subject").notNull(),
  correspondenceType: text("correspondence_type").notNull().default("payer_correspondence"),
  receivedDate: date("received_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  clientId: uuid("client_id").references(() => clientsTable.id),
  providerId: uuid("provider_id").references(() => providersTable.id),
  authorizationId: uuid("authorization_id").references(() => authorizationsTable.id),
  appealId: uuid("appeal_id").references(() => appealsTable.id),
  documentId: uuid("document_id").references(() => documentsTable.id),
  assignedUserId: uuid("assigned_user_id"),
  dueDate: date("due_date", { mode: "string" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  sourceEventType: text("source_event_type"),
  sourceEventId: uuid("source_event_id"),
});

export const documentHistoryTable = pgTable("document_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  actorId: uuid("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appointmentRemindersTable = pgTable("appointment_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("email"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referralOutsTable = pgTable("referral_outs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  referredByProviderId: uuid("referred_by_provider_id").references(() => providersTable.id, { onDelete: "set null" }),
  destinationName: text("destination_name").notNull(),
  specialty: text("specialty"),
  phone: text("phone"),
  fax: text("fax"),
  email: text("email"),
  payerName: text("payer_name"),
  reason: text("reason"),
  status: text("status").notNull().default("draft"),
  referredAt: timestamp("referred_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recordsRequestsTable = pgTable("records_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  requestDirection: text("request_direction").notNull().default("outbound"),
  requesterName: text("requester_name").notNull(),
  requestType: text("request_type").notNull().default("medical_records"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  dueDate: date("due_date", { mode: "string" }),
  status: text("status").notNull().default("received"),
  deliveryMethod: text("delivery_method"),
  documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const complianceScreeningsTable = pgTable("compliance_screenings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").references(() => providersTable.id, { onDelete: "cascade" }),
  screeningType: text("screening_type").notNull(),
  status: text("status").notNull().default("due"),
  result: text("result"),
  dueDate: date("due_date", { mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  notes: text("notes"),
  evidenceDocumentId: uuid("evidence_document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountNote = typeof accountNotesTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type StatusHistory = typeof statusHistoryTable.$inferSelect;
export type SystemEvent = typeof systemEventsTable.$inferSelect;
export type PhiAccessLog = typeof phiAccessLogsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type Document = typeof documentsTable.$inferSelect;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
export type ImportRow = typeof importRowsTable.$inferSelect;
export type ImportValidationError = typeof importValidationErrorsTable.$inferSelect;
export type MailroomItem = typeof mailroomItemsTable.$inferSelect;
export type DocumentHistory = typeof documentHistoryTable.$inferSelect;
export type AppointmentReminder = typeof appointmentRemindersTable.$inferSelect;
export type ReferralOut = typeof referralOutsTable.$inferSelect;
export type RecordsRequest = typeof recordsRequestsTable.$inferSelect;
export type ComplianceScreening = typeof complianceScreeningsTable.$inferSelect;
