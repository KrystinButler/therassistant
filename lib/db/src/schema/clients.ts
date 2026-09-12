import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import {
  payersTable,
  payerPlansTable,
} from "./payers";

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),

  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, {
      onDelete: "cascade",
    }),

  firstName: text("first_name").notNull(),

  middleName: text("middle_name"),

  lastName: text("last_name").notNull(),

  preferredName: text("preferred_name"),

  dateOfBirth: date("date_of_birth", {
    mode: "string",
  }),

  email: text("email"),

  phone: text("phone"),

  addressLine1: text("address_line1"),

  addressLine2: text("address_line2"),

  city: text("city"),

  state: text("state"),

  postalCode: text("postal_code"),

  clientStatus: text("client_status")
    .notNull()
    .default("active"),

  registrationStatus: text("registration_status")
    .notNull()
    .default("complete"),

  billingReadinessStatus: text("billing_readiness_status")
    .notNull()
    .default("ready"),

  searchName: text("search_name"),

  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  deletedAt: timestamp("deleted_at", {
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

export const clientInsurancePoliciesTable = pgTable(
  "client_insurance_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id, {
        onDelete: "cascade",
      }),

    payerId: uuid("payer_id")
      .notNull()
      .references(() => payersTable.id),

    payerPlanId: uuid("payer_plan_id")
      .references(() => payerPlansTable.id),

    insuranceOrder: integer("insurance_order")
      .notNull()
      .default(1),

    status: text("status")
      .notNull()
      .default("active"),

    memberId: text("member_id"),

    groupNumber: text("group_number"),

    subscriberName: text("subscriber_name"),

    subscriberDob: date("subscriber_dob", {
      mode: "string",
    }),

    relationshipToSubscriber: text(
      "relationship_to_subscriber",
    ),

    effectiveDate: date("effective_date", {
      mode: "string",
    }),

    terminationDate: date("termination_date", {
      mode: "string",
    }),

    metadata: jsonb("metadata")
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
  },
);

export type Client = typeof clientsTable.$inferSelect;
export type NewClient = typeof clientsTable.$inferInsert;

export type ClientInsurancePolicy =
  typeof clientInsurancePoliciesTable.$inferSelect;

export type NewClientInsurancePolicy =
  typeof clientInsurancePoliciesTable.$inferInsert;
