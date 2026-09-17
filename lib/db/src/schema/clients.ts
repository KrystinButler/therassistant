import {
  boolean,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { payersTable, payerPlansTable } from "./payers";
import {
  billingReadinessStatusEnum,
  clientStatusEnum,
  insuranceOrderEnum,
  insurancePolicyStatusEnum,
  registrationStatusEnum,
} from "./enums";

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  middleName: text("middle_name"),
  lastName: text("last_name").notNull(),
  preferredName: text("preferred_name"),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  email: text("email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  clientStatus: clientStatusEnum("client_status").notNull().default("intake"),
  registrationStatus: registrationStatusEnum("registration_status").notNull().default("not_started"),
  billingReadinessStatus: billingReadinessStatusEnum("billing_readiness_status").notNull().default("not_ready"),
  searchName: text("search_name"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientContactsTable = pgTable("client_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  contactName: text("contact_name").notNull(),
  relationship: text("relationship"),
  phone: text("phone"),
  email: text("email"),
  isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
  isResponsibleParty: boolean("is_responsible_party").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientInsurancePoliciesTable = pgTable("client_insurance_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  payerId: uuid("payer_id").notNull().references(() => payersTable.id),
  payerPlanId: uuid("payer_plan_id").references(() => payerPlansTable.id),
  insuranceOrder: insuranceOrderEnum("insurance_order").notNull().default("primary"),
  status: insurancePolicyStatusEnum("status").notNull().default("pending_verification"),
  memberId: text("member_id").notNull(),
  groupNumber: text("group_number"),
  subscriberName: text("subscriber_name"),
  subscriberDob: date("subscriber_dob", { mode: "string" }),
  relationshipToSubscriber: text("relationship_to_subscriber").default("self"),
  effectiveDate: date("effective_date", { mode: "string" }),
  terminationDate: date("termination_date", { mode: "string" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Client = typeof clientsTable.$inferSelect;
export type NewClient = typeof clientsTable.$inferInsert;
export type ClientContact = typeof clientContactsTable.$inferSelect;
export type ClientInsurancePolicy = typeof clientInsurancePoliciesTable.$inferSelect;
export type NewClientInsurancePolicy = typeof clientInsurancePoliciesTable.$inferInsert;
