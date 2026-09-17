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
import { clientsTable, clientInsurancePoliciesTable } from "./clients";
import { payersTable } from "./payers";
import { appointmentsTable } from "./clinical";
import {
  authorizationStatusEnum,
  diagnosisStatusEnum,
  eligibilityStatusEnum,
} from "./enums";

export const clientDiagnosesTable = pgTable("client_diagnoses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  diagnosisCode: text("diagnosis_code").notNull(),
  description: text("description"),
  diagnosisStatus: diagnosisStatusEnum("diagnosis_status").notNull().default("active"),
  onsetDate: date("onset_date", { mode: "string" }),
  resolvedDate: date("resolved_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientCheckinsTable = pgTable("client_checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").notNull().unique().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  onMyWayAt: timestamp("on_my_way_at", { withTimezone: true }),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  responses: jsonb("responses").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientBalanceSummariesTable = pgTable("client_balance_summaries", {
  clientId: uuid("client_id").primaryKey().references(() => clientsTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  openBalanceCents: bigint("open_balance_cents", { mode: "number" }).notNull().default(0),
  creditBalanceCents: bigint("credit_balance_cents", { mode: "number" }).notNull().default(0),
  lastCalculatedAt: timestamp("last_calculated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eligibilityChecksTable = pgTable("eligibility_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  insurancePolicyId: uuid("insurance_policy_id").references(() => clientInsurancePoliciesTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  eligibilityStatus: eligibilityStatusEnum("eligibility_status").notNull().default("pending"),
  checkedBy: uuid("checked_by"),
  responseSource: text("response_source"),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eligibilityBenefitsTable = pgTable("eligibility_benefits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eligibilityCheckId: uuid("eligibility_check_id").notNull().references(() => eligibilityChecksTable.id, { onDelete: "cascade" }),
  benefitType: text("benefit_type").notNull(),
  cptCode: text("cpt_code"),
  copayCents: bigint("copay_cents", { mode: "number" }),
  coinsurancePercent: numeric("coinsurance_percent"),
  deductibleRemainingCents: bigint("deductible_remaining_cents", { mode: "number" }),
  oopRemainingCents: bigint("oop_remaining_cents", { mode: "number" }),
  authorizationRequired: boolean("authorization_required"),
  networkStatus: text("network_status"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authorizationsTable = pgTable("authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").references(() => payersTable.id),
  authorizationNumber: text("authorization_number"),
  status: authorizationStatusEnum("status").notNull().default("pending"),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authorizationUnitsTable = pgTable("authorization_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  authorizationId: uuid("authorization_id").notNull().references(() => authorizationsTable.id, { onDelete: "cascade" }),
  cptCode: text("cpt_code"),
  authorizedUnits: numeric("authorized_units").notNull().default("0"),
  usedUnits: numeric("used_units").notNull().default("0"),
  remainingUnits: numeric("remaining_units"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientDiagnosis = typeof clientDiagnosesTable.$inferSelect;
export type ClientCheckin = typeof clientCheckinsTable.$inferSelect;
export type ClientBalanceSummary = typeof clientBalanceSummariesTable.$inferSelect;
export type EligibilityCheck = typeof eligibilityChecksTable.$inferSelect;
export type EligibilityBenefit = typeof eligibilityBenefitsTable.$inferSelect;
export type Authorization = typeof authorizationsTable.$inferSelect;
export type AuthorizationUnit = typeof authorizationUnitsTable.$inferSelect;
