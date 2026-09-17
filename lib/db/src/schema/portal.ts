import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { providersTable } from "./providers";
import { treatmentPlanGoalsTable } from "./clinical";

export const patientJournalEntriesTable = pgTable("patient_journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  entryDate: date("entry_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  entryText: text("entry_text").notNull(),
  mood: text("mood"),
  authorType: text("author_type").notNull().default("patient"),
  reviewStatus: text("review_status").notNull().default("unreviewed"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByProviderId: uuid("reviewed_by_provider_id").references(() => providersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  visibility: text("visibility").notNull().default("shared_with_provider"),
  tags: jsonb("tags").$type<unknown[]>().notNull().default([]),
  relatedTreatmentGoalId: uuid("related_treatment_goal_id").references(() => treatmentPlanGoalsTable.id),
  entryStatus: text("entry_status").notNull().default("submitted"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const patientPaymentPlansTable = pgTable("patient_payment_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  requestedMonthlyAmountCents: bigint("requested_monthly_amount_cents", { mode: "number" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portalBalanceExceptionRequestsTable = pgTable("portal_balance_exception_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PatientJournalEntry = typeof patientJournalEntriesTable.$inferSelect;
export type NewPatientJournalEntry = typeof patientJournalEntriesTable.$inferInsert;
export type PatientPaymentPlan = typeof patientPaymentPlansTable.$inferSelect;
export type PortalBalanceExceptionRequest = typeof portalBalanceExceptionRequestsTable.$inferSelect;
