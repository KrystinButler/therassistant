import {
  bigint,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { providersTable } from "./providers";
import { payersTable } from "./payers";
import { chargeCaptureItemsTable } from "./clinical";
import {
  appealStatusEnum,
  claimStatusEnum,
  denialCategoryEnum,
  denialStatusEnum,
  denialWorkabilityEnum,
  noteVisibilityEnum,
} from "./enums";

export const professionalClaimsTable = pgTable("professional_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  chargeId: uuid("charge_id").references(() => chargeCaptureItemsTable.id),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  renderingProviderId: uuid("rendering_provider_id").references(() => providersTable.id),
  billingProviderId: uuid("billing_provider_id").references(() => providersTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  claimStatus: claimStatusEnum("claim_status").notNull().default("ready_for_validation"),
  serviceDateFrom: date("service_date_from", { mode: "string" }),
  serviceDateTo: date("service_date_to", { mode: "string" }),
  totalChargeCents: bigint("total_charge_cents", { mode: "number" }).notNull().default(0),
  patientControlNumber: text("patient_control_number"),
  payerClaimNumber: text("payer_claim_number"),
  clearinghouseClaimId: text("clearinghouse_claim_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  sourceEncounterId: uuid("source_encounter_id"),
});

export const professionalClaimLinesTable = pgTable("professional_claim_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").notNull().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  cptCode: text("cpt_code").notNull(),
  modifier1: text("modifier1"),
  modifier2: text("modifier2"),
  diagnosisPointer: text("diagnosis_pointer"),
  units: numeric("units").notNull().default("1"),
  chargeAmountCents: bigint("charge_amount_cents", { mode: "number" }).notNull().default(0),
  allowedAmountCents: bigint("allowed_amount_cents", { mode: "number" }),
  paidAmountCents: bigint("paid_amount_cents", { mode: "number" }).notNull().default(0),
  adjustmentAmountCents: bigint("adjustment_amount_cents", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimDiagnosesTable = pgTable("claim_diagnoses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").notNull().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  diagnosisCode: text("diagnosis_code").notNull(),
  pointerOrder: integer("pointer_order").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimNotesTable = pgTable("claim_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").notNull().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  visibility: noteVisibilityEnum("visibility").notNull().default("billing_only"),
  noteText: text("note_text").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimStatusHistoryTable = pgTable("claim_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").notNull().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  oldStatus: claimStatusEnum("old_status"),
  newStatus: claimStatusEnum("new_status").notNull(),
  reason: text("reason"),
  changedBy: uuid("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimBalanceSummariesTable = pgTable("claim_balance_summaries", {
  claimId: uuid("claim_id").primaryKey().references(() => professionalClaimsTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  totalChargeCents: bigint("total_charge_cents", { mode: "number" }).notNull().default(0),
  paidAmountCents: bigint("paid_amount_cents", { mode: "number" }).notNull().default(0),
  adjustmentAmountCents: bigint("adjustment_amount_cents", { mode: "number" }).notNull().default(0),
  openBalanceCents: bigint("open_balance_cents", { mode: "number" }).notNull().default(0),
  lastCalculatedAt: timestamp("last_calculated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const denialsTable = pgTable("denials", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  clientId: uuid("client_id").references(() => clientsTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  denialDate: date("denial_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  denialStatus: denialStatusEnum("denial_status").notNull().default("new"),
  denialCategory: denialCategoryEnum("denial_category").notNull().default("other"),
  workability: denialWorkabilityEnum("workability").notNull().default("needs_review"),
  carcCode: text("carc_code"),
  rarcCode: text("rarc_code"),
  amountCents: bigint("amount_cents", { mode: "number" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  timelyFilingDeadline: date("timely_filing_deadline", { mode: "string" }),
});

export const appealsTable = pgTable("appeals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  denialId: uuid("denial_id").references(() => denialsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  appealStatus: appealStatusEnum("appeal_status").notNull().default("not_started"),
  appealLevel: text("appeal_level"),
  deadlineDate: date("deadline_date", { mode: "string" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  outcome: text("outcome"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProfessionalClaim = typeof professionalClaimsTable.$inferSelect;
export type NewProfessionalClaim = typeof professionalClaimsTable.$inferInsert;
export type ProfessionalClaimLine = typeof professionalClaimLinesTable.$inferSelect;
export type NewProfessionalClaimLine = typeof professionalClaimLinesTable.$inferInsert;
export type ClaimDiagnosis = typeof claimDiagnosesTable.$inferSelect;
export type ClaimNote = typeof claimNotesTable.$inferSelect;
export type ClaimStatusHistory = typeof claimStatusHistoryTable.$inferSelect;
export type ClaimBalanceSummary = typeof claimBalanceSummariesTable.$inferSelect;
export type Denial = typeof denialsTable.$inferSelect;
export type NewDenial = typeof denialsTable.$inferInsert;
export type Appeal = typeof appealsTable.$inferSelect;
export type NewAppeal = typeof appealsTable.$inferInsert;
