import {
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { payersTable } from "./payers";
import {
  professionalClaimsTable,
  professionalClaimLinesTable,
} from "./claims";

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),

  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, {
      onDelete: "cascade",
    }),

  clientId: uuid("client_id")
    .references(() => clientsTable.id),

  payerId: uuid("payer_id")
    .references(() => payersTable.id),

  paymentSource: text("payment_source")
    .notNull()
    .default("payer"),

  paymentMethod: text("payment_method"),

  paymentStatus: text("payment_status")
    .notNull()
    .default("posted"),

  paymentDate: date("payment_date", {
    mode: "string",
  }),

  amountCents: integer("amount_cents")
    .notNull()
    .default(0),

  checkNumber: text("check_number"),

  traceNumber: text("trace_number"),

  notes: text("notes"),

  postedBy: uuid("posted_by"),

  postedAt: timestamp("posted_at", {
    withTimezone: true,
  }),

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

export const paymentAllocationsTable = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    paymentId: uuid("payment_id")
      .notNull()
      .references(() => paymentsTable.id, {
        onDelete: "cascade",
      }),

    clientId: uuid("client_id")
      .references(() => clientsTable.id),

    claimId: uuid("claim_id")
      .references(() => professionalClaimsTable.id),

    claimLineId: uuid("claim_line_id")
      .references(() => professionalClaimLinesTable.id),

    amountCents: integer("amount_cents")
      .notNull()
      .default(0),

    reversedAt: timestamp("reversed_at", {
      withTimezone: true,
    }),

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
  },
);

export type Payment =
  typeof paymentsTable.$inferSelect;

export type NewPayment =
  typeof paymentsTable.$inferInsert;

export type PaymentAllocation =
  typeof paymentAllocationsTable.$inferSelect;

export type NewPaymentAllocation =
  typeof paymentAllocationsTable.$inferInsert;
