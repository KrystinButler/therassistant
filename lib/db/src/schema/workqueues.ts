import {
  date,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import {
  workqueuePriorityEnum,
  workqueueSourceObjectTypeEnum,
  workqueueStatusEnum,
  workqueueTypeEnum,
} from "./enums";

export const workqueueItemsTable = pgTable("workqueue_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  workqueueType: workqueueTypeEnum("workqueue_type").notNull(),
  workqueueStatus: workqueueStatusEnum("workqueue_status").notNull().default("open"),
  priority: workqueuePriorityEnum("priority").notNull().default("normal"),
  sourceObjectType: workqueueSourceObjectTypeEnum("source_object_type").notNull(),
  sourceObjectId: uuid("source_object_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date", { mode: "string" }),
  assignedUserId: uuid("assigned_user_id"),
  createdBy: uuid("created_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workqueueHistoryTable = pgTable("workqueue_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  workqueueItemId: uuid("workqueue_item_id").notNull().references(() => workqueueItemsTable.id, { onDelete: "cascade" }),
  oldStatus: workqueueStatusEnum("old_status"),
  newStatus: workqueueStatusEnum("new_status"),
  oldPriority: workqueuePriorityEnum("old_priority"),
  newPriority: workqueuePriorityEnum("new_priority"),
  changedBy: uuid("changed_by"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkqueueItem = typeof workqueueItemsTable.$inferSelect;
export type NewWorkqueueItem = typeof workqueueItemsTable.$inferInsert;
export type WorkqueueHistory = typeof workqueueHistoryTable.$inferSelect;
export type NewWorkqueueHistory = typeof workqueueHistoryTable.$inferInsert;
