import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  systemRoleEnum,
  tenantStatusEnum,
  tenantTypeEnum,
  userStatusEnum,
} from "./enums";

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tenantType: tenantTypeEnum("tenant_type").notNull().default("practice"),
  status: tenantStatusEnum("status").notNull().default("pending_setup"),
  timezone: text("timezone").notNull().default("America/Denver"),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

export const userProfilesTable = pgTable("user_profiles", {
  id: uuid("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  email: text("email"),
  phone: text("phone"),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantUsersTable = pgTable("tenant_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  userId: uuid("user_id").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantUserRolesTable = pgTable("tenant_user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  userId: uuid("user_id").notNull(),
  role: systemRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingCompanyPracticeLinksTable = pgTable("billing_company_practice_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingCompanyTenantId: uuid("billing_company_tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  practiceTenantId: uuid("practice_tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  status: tenantStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type NewTenant = typeof tenantsTable.$inferInsert;
export type UserProfile = typeof userProfilesTable.$inferSelect;
export type TenantUser = typeof tenantUsersTable.$inferSelect;
export type TenantUserRole = typeof tenantUserRolesTable.$inferSelect;
export type BillingCompanyPracticeLink = typeof billingCompanyPracticeLinksTable.$inferSelect;
