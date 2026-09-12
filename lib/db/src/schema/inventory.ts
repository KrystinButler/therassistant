import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const inventoryTable = pgTable("inventory_records", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectName: text("object_name").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  schemaName: text("schema_name"),
  columnCount: integer("column_count").notNull().default(0),
  rowCount: integer("row_count").notNull().default(0),
  columns: jsonb("columns").$type<string[]>().notNull().default([]),
  details: jsonb("details")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;