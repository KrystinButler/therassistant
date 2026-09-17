import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const payersTable = pgTable("payers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name"),
  payerType: text("payer_type"),
  clearinghousePayerId: text("clearinghouse_payer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payerPlansTable = pgTable("payer_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  payerId: uuid("payer_id").notNull().references(() => payersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  planType: text("plan_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payerAliasesTable = pgTable("payer_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  payerId: uuid("payer_id").notNull().references(() => payersTable.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payer = typeof payersTable.$inferSelect;
export type NewPayer = typeof payersTable.$inferInsert;
export type PayerPlan = typeof payerPlansTable.$inferSelect;
export type NewPayerPlan = typeof payerPlansTable.$inferInsert;
export type PayerAlias = typeof payerAliasesTable.$inferSelect;
