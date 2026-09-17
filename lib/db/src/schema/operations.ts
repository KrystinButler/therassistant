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
