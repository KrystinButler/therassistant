import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";

export const providersTable = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),

  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, {
      onDelete: "cascade",
    }),

  firstName: text("first_name").notNull(),

  lastName: text("last_name").notNull(),

  credentials: text("credentials"),

  providerStatus: text("provider_status")
    .notNull()
    .default("active"),

  individualNpi: text("individual_npi"),

  taxonomyCode: text("taxonomy_code"),

  email: text("email"),

  phone: text("phone"),

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
});

export type Provider =
  typeof providersTable.$inferSelect;

export type NewProvider =
  typeof providersTable.$inferInsert;
