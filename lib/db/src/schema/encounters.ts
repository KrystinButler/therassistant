import {
  bigint,
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable, clientInsurancePoliciesTable } from "./clients";
import { providersTable } from "./providers";
import { payersTable } from "./payers";
import { appointmentsTable } from "./clinical";

export const encountersTable = pgTable("encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").unique().references(() => appointmentsTable.id),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id),
  providerId: uuid("provider_id").references(() => providersTable.id),
  insurancePolicyId: uuid("insurance_policy_id").references(() => clientInsurancePoliciesTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  encounterStatus: text("encounter_status").notNull().default("in_progress"),
  billingStatus: text("billing_status").notNull().default("not_ready"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  locationType: text("location_type"),
  serviceType: text("service_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const encounterDiagnosesTable = pgTable("encounter_diagnoses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  encounterId: uuid("encounter_id").notNull().references(() => encountersTable.id, { onDelete: "cascade" }),
  diagnosisCode: text("diagnosis_code").notNull(),
  diagnosisDescription: text("diagnosis_description"),
  isPrimary: boolean("is_primary").notNull().default(false),
  sequenceNumber: integer("sequence_number").notNull().default(1),
  presentOnClaim: boolean("present_on_claim").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const encounterServiceLinesTable = pgTable("encounter_service_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  encounterId: uuid("encounter_id").notNull().references(() => encountersTable.id, { onDelete: "cascade" }),
  cptHcpcsCode: text("cpt_hcpcs_code").notNull(),
  modifier1: text("modifier1"),
  modifier2: text("modifier2"),
  units: numeric("units").notNull().default("1"),
  chargeAmountCents: bigint("charge_amount_cents", { mode: "number" }).notNull().default(0),
  placeOfServiceCode: text("place_of_service_code"),
  readyForClaim: boolean("ready_for_claim").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const encounterReadinessChecksTable = pgTable("encounter_readiness_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  encounterId: uuid("encounter_id").notNull().references(() => encountersTable.id, { onDelete: "cascade" }),
  checkCode: text("check_code").notNull(),
  checkStatus: text("check_status").notNull(),
  blocking: boolean("blocking").notNull().default(false),
  message: text("message").notNull(),
  action: text("action"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Encounter = typeof encountersTable.$inferSelect;
export type NewEncounter = typeof encountersTable.$inferInsert;
export type EncounterDiagnosis = typeof encounterDiagnosesTable.$inferSelect;
export type EncounterServiceLine = typeof encounterServiceLinesTable.$inferSelect;
export type EncounterReadinessCheck = typeof encounterReadinessChecksTable.$inferSelect;
