import {
  date,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { payersTable } from "./payers";
import { providerEnrollmentStatusEnum, providerStatusEnum } from "./enums";

export const providersTable = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  credentials: text("credentials"),
  providerStatus: providerStatusEnum("provider_status").notNull().default("active"),
  individualNpi: text("individual_npi"),
  taxonomyCode: text("taxonomy_code"),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerIdentifiersTable = pgTable("provider_identifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").notNull().references(() => providersTable.id, { onDelete: "cascade" }),
  identifierType: text("identifier_type").notNull(),
  identifierValue: text("identifier_value").notNull(),
  payerId: uuid("payer_id").references(() => payersTable.id),
  effectiveDate: date("effective_date", { mode: "string" }),
  terminationDate: date("termination_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerPayerEnrollmentsTable = pgTable("provider_payer_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").notNull().references(() => providersTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").notNull().references(() => payersTable.id),
  enrollmentStatus: providerEnrollmentStatusEnum("enrollment_status").notNull().default("not_started"),
  effectiveDate: date("effective_date", { mode: "string" }),
  terminationDate: date("termination_date", { mode: "string" }),
  payerProviderId: text("payer_provider_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revalidationDueDate: date("revalidation_due_date", { mode: "string" }),
});

export type Provider = typeof providersTable.$inferSelect;
export type NewProvider = typeof providersTable.$inferInsert;
export type ProviderIdentifier = typeof providerIdentifiersTable.$inferSelect;
export type ProviderPayerEnrollment = typeof providerPayerEnrollmentsTable.$inferSelect;
