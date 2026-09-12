import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),

  name: text("name").notNull(),

  tenantType: text("tenant_type")
    .notNull()
    .default("practice"),

  status: text("status")
    .notNull()
    .default("active"),

  timezone: text("timezone")
    .notNull()
    .default("America/Denver"),

  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  createdBy: uuid("created_by"),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type NewTenant = typeof tenantsTable.$inferInsert;
