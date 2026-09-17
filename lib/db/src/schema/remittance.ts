import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { payersTable } from "./payers";
import { professionalClaimsTable, professionalClaimLinesTable } from "./claims";
import { paymentsTable } from "./payments";
import {
  accountingPeriodStatusEnum,
  adjustmentStatusEnum,
  adjustmentTypeEnum,
  contractStatusEnum,
  eraFileStatusEnum,
  eraMatchStatusEnum,
  historicalTransactionStatusEnum,
  historicalTransactionTypeEnum,
  ledgerAccountTypeEnum,
  ledgerEntryTypeEnum,
  ledgerSideEnum,
} from "./enums";

export const payerContractsTable = pgTable("payer_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").notNull().references(() => payersTable.id),
  contractName: text("contract_name").notNull(),
  status: contractStatusEnum("status").notNull().default("draft"),
  effectiveDate: date("effective_date", { mode: "string" }),
  terminationDate: date("termination_date", { mode: "string" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeSchedulesTable = pgTable("fee_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  payerContractId: uuid("payer_contract_id").references(() => payerContractsTable.id),
  name: text("name").notNull(),
  status: contractStatusEnum("status").notNull().default("draft"),
  effectiveDate: date("effective_date", { mode: "string" }),
  terminationDate: date("termination_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeScheduleLinesTable = pgTable("fee_schedule_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  feeScheduleId: uuid("fee_schedule_id").notNull().references(() => feeSchedulesTable.id, { onDelete: "cascade" }),
  cptCode: text("cpt_code").notNull(),
  modifier: text("modifier"),
  rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
  unitType: text("unit_type").default("service"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eraFilesTable = pgTable("era_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").references(() => payersTable.id),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  checkOrTraceNumber: text("check_or_trace_number"),
  paymentAmountCents: bigint("payment_amount_cents", { mode: "number" }),
  status: eraFileStatusEnum("status").notNull().default("uploaded"),
  rawMetadata: jsonb("raw_metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eraClaimsTable = pgTable("era_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eraFileId: uuid("era_file_id").notNull().references(() => eraFilesTable.id, { onDelete: "cascade" }),
  payerClaimNumber: text("payer_claim_number"),
  patientControlNumber: text("patient_control_number"),
  clientId: uuid("client_id").references(() => clientsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  chargeAmountCents: bigint("charge_amount_cents", { mode: "number" }),
  paidAmountCents: bigint("paid_amount_cents", { mode: "number" }),
  status: eraMatchStatusEnum("status").notNull().default("unmatched"),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eraServiceLinesTable = pgTable("era_service_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eraClaimId: uuid("era_claim_id").notNull().references(() => eraClaimsTable.id, { onDelete: "cascade" }),
  claimLineId: uuid("claim_line_id").references(() => professionalClaimLinesTable.id),
  serviceDate: date("service_date", { mode: "string" }),
  cptCode: text("cpt_code"),
  chargeAmountCents: bigint("charge_amount_cents", { mode: "number" }),
  paidAmountCents: bigint("paid_amount_cents", { mode: "number" }),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eraAdjustmentsTable = pgTable("era_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eraClaimId: uuid("era_claim_id").references(() => eraClaimsTable.id),
  eraServiceLineId: uuid("era_service_line_id").references(() => eraServiceLinesTable.id),
  groupCode: text("group_code"),
  carcCode: text("carc_code"),
  rarcCode: text("rarc_code"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eraMatchesTable = pgTable("era_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eraClaimId: uuid("era_claim_id").notNull().references(() => eraClaimsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  matchStatus: eraMatchStatusEnum("match_status").notNull().default("unmatched"),
  confidence: numeric("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adjustmentsTable = pgTable("adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  adjustmentType: adjustmentTypeEnum("adjustment_type").notNull(),
  adjustmentStatus: adjustmentStatusEnum("adjustment_status").notNull().default("pending"),
  adjustmentDate: date("adjustment_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  reason: text("reason"),
  carcCode: text("carc_code"),
  postedBy: uuid("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adjustmentAllocationsTable = pgTable("adjustment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  adjustmentId: uuid("adjustment_id").notNull().references(() => adjustmentsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  claimLineId: uuid("claim_line_id").references(() => professionalClaimLinesTable.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentReversalsTable = pgTable("payment_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id),
  reason: text("reason").notNull(),
  reversedBy: uuid("reversed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adjustmentReversalsTable = pgTable("adjustment_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  adjustmentId: uuid("adjustment_id").notNull().references(() => adjustmentsTable.id),
  reason: text("reason").notNull(),
  reversedBy: uuid("reversed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const historicalTransactionsTable = pgTable("historical_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  transactionType: historicalTransactionTypeEnum("transaction_type").notNull(),
  transactionStatus: historicalTransactionStatusEnum("transaction_status").notNull().default("draft"),
  transactionDate: date("transaction_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  description: text("description"),
  legacySource: text("legacy_source"),
  postedBy: uuid("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const historicalTransactionAllocationsTable = pgTable("historical_transaction_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  historicalTransactionId: uuid("historical_transaction_id").notNull().references(() => historicalTransactionsTable.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerAccountsTable = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  accountCode: text("account_code").notNull(),
  accountName: text("account_name").notNull(),
  accountType: ledgerAccountTypeEnum("account_type").notNull(),
  isSystemAccount: boolean("is_system_account").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerTransactionsTable = pgTable("ledger_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  transactionDate: date("transaction_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  description: text("description"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  ledgerTransactionId: uuid("ledger_transaction_id").notNull().references(() => ledgerTransactionsTable.id, { onDelete: "cascade" }),
  ledgerAccountId: uuid("ledger_account_id").references(() => ledgerAccountsTable.id),
  clientId: uuid("client_id").references(() => clientsTable.id),
  claimId: uuid("claim_id").references(() => professionalClaimsTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  entryType: ledgerEntryTypeEnum("entry_type").notNull(),
  side: ledgerSideEnum("side").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  postingDate: date("posting_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountingPeriodsTable = pgTable("accounting_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  periodName: text("period_name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: accountingPeriodStatusEnum("status").notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayerContract = typeof payerContractsTable.$inferSelect;
export type FeeSchedule = typeof feeSchedulesTable.$inferSelect;
export type FeeScheduleLine = typeof feeScheduleLinesTable.$inferSelect;
export type EraFile = typeof eraFilesTable.$inferSelect;
export type EraClaim = typeof eraClaimsTable.$inferSelect;
export type EraServiceLine = typeof eraServiceLinesTable.$inferSelect;
export type EraAdjustment = typeof eraAdjustmentsTable.$inferSelect;
export type EraMatch = typeof eraMatchesTable.$inferSelect;
export type Adjustment = typeof adjustmentsTable.$inferSelect;
export type AdjustmentAllocation = typeof adjustmentAllocationsTable.$inferSelect;
export type PaymentReversal = typeof paymentReversalsTable.$inferSelect;
export type AdjustmentReversal = typeof adjustmentReversalsTable.$inferSelect;
export type HistoricalTransaction = typeof historicalTransactionsTable.$inferSelect;
export type HistoricalTransactionAllocation = typeof historicalTransactionAllocationsTable.$inferSelect;
export type LedgerAccount = typeof ledgerAccountsTable.$inferSelect;
export type LedgerTransaction = typeof ledgerTransactionsTable.$inferSelect;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
export type AccountingPeriod = typeof accountingPeriodsTable.$inferSelect;
