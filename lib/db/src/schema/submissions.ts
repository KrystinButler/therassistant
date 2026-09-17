import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { professionalClaimsTable } from "./claims";
import { claimBatchStatusEnum, submissionStatusEnum } from "./enums";

export const claimBatchesTable = pgTable("claim_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  batchStatus: claimBatchStatusEnum("batch_status").notNull().default("created"),
  batchName: text("batch_name"),
  claimCount: integer("claim_count").notNull().default(0),
  totalChargeCents: bigint("total_charge_cents", { mode: "number" }).notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimBatchItemsTable = pgTable("claim_batch_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull().references(() => claimBatchesTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").notNull().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimSubmissionsTable = pgTable("claim_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => claimBatchesTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  submissionStatus: submissionStatusEnum("submission_status").notNull().default("created"),
  submissionMethod: text("submission_method"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissionResponsesTable = pgTable("submission_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").references(() => claimSubmissionsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  responseStatus: submissionStatusEnum("response_status").notNull(),
  responseCode: text("response_code"),
  responseMessage: text("response_message"),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClaimBatch = typeof claimBatchesTable.$inferSelect;
export type ClaimBatchItem = typeof claimBatchItemsTable.$inferSelect;
export type ClaimSubmission = typeof claimSubmissionsTable.$inferSelect;
export type SubmissionResponse = typeof submissionResponsesTable.$inferSelect;
