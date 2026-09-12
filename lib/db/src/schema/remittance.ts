import {
  bigint,
  date,
  jsonb,
  numeric,
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
import { paymentsTable } from "./payments";


/* =========================================================
   PAYER CONTRACTS + FEE SCHEDULES
   ========================================================= */

export const payerContractsTable = pgTable(
  "payer_contracts",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    payerId: uuid("payer_id")
      .notNull()
      .references(() => payersTable.id),

    contractName: text("contract_name")
      .notNull(),

    status: text("status")
      .notNull()
      .default("active"),

    effectiveDate: date("effective_date", {
      mode: "string",
    }),

    terminationDate: date(
      "termination_date",
      {
        mode: "string",
      },
    ),

    notes: text("notes"),

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


export const feeSchedulesTable = pgTable(
  "fee_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    payerContractId: uuid(
      "payer_contract_id",
    )
      .notNull()
      .references(
        () => payerContractsTable.id,
        {
          onDelete: "cascade",
        },
      ),

    name: text("name")
      .notNull(),

    status: text("status")
      .notNull()
      .default("active"),

    effectiveDate: date("effective_date", {
      mode: "string",
    }),

    terminationDate: date(
      "termination_date",
      {
        mode: "string",
      },
    ),

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


export const feeScheduleLinesTable = pgTable(
  "fee_schedule_lines",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    feeScheduleId: uuid(
      "fee_schedule_id",
    )
      .notNull()
      .references(
        () => feeSchedulesTable.id,
        {
          onDelete: "cascade",
        },
      ),

    cptCode: text("cpt_code")
      .notNull(),

    modifier: text("modifier"),

    rateCents: bigint("rate_cents", {
      mode: "number",
    })
      .notNull(),

    unitType: text("unit_type"),

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


/* =========================================================
   ERA
   ========================================================= */

export const eraFilesTable = pgTable(
  "era_files",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    payerId: uuid("payer_id")
      .references(() => payersTable.id),

    fileName: text("file_name")
      .notNull(),

    storagePath: text("storage_path"),

    checkOrTraceNumber: text(
      "check_or_trace_number",
    ),

    paymentAmountCents: bigint(
      "payment_amount_cents",
      {
        mode: "number",
      },
    )
      .notNull()
      .default(0),

    status: text("status")
      .notNull()
      .default("received"),

    rawMetadata: jsonb("raw_metadata")
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


export const eraClaimsTable = pgTable(
  "era_claims",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    eraFileId: uuid("era_file_id")
      .notNull()
      .references(() => eraFilesTable.id, {
        onDelete: "cascade",
      }),

    payerClaimNumber: text(
      "payer_claim_number",
    ),

    patientControlNumber: text(
      "patient_control_number",
    ),

    clientId: uuid("client_id")
      .references(() => clientsTable.id),

    claimId: uuid("claim_id")
      .references(
        () => professionalClaimsTable.id,
      ),

    chargeAmountCents: bigint(
      "charge_amount_cents",
      {
        mode: "number",
      },
    )
      .notNull()
      .default(0),

    paidAmountCents: bigint(
      "paid_amount_cents",
      {
        mode: "number",
      },
    )
      .notNull()
      .default(0),

    status: text("status")
      .notNull()
      .default("received"),

    rawData: jsonb("raw_data")
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


export const eraServiceLinesTable = pgTable(
  "era_service_lines",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    eraClaimId: uuid("era_claim_id")
      .notNull()
      .references(() => eraClaimsTable.id, {
        onDelete: "cascade",
      }),

    claimLineId: uuid("claim_line_id")
      .references(
        () => professionalClaimLinesTable.id,
      ),

    serviceDate: date("service_date", {
      mode: "string",
    }),

    cptCode: text("cpt_code"),

    chargeAmountCents: bigint(
      "charge_amount_cents",
      {
        mode: "number",
      },
    )
      .notNull()
      .default(0),

    paidAmountCents: bigint(
      "paid_amount_cents",
      {
        mode: "number",
      },
    )
      .notNull()
      .default(0),

    rawData: jsonb("raw_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
);


export const eraAdjustmentsTable = pgTable(
  "era_adjustments",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    eraClaimId: uuid("era_claim_id")
      .notNull()
      .references(() => eraClaimsTable.id, {
        onDelete: "cascade",
      }),

    eraServiceLineId: uuid(
      "era_service_line_id",
    ).references(
      () => eraServiceLinesTable.id,
    ),

    groupCode: text("group_code"),

    carcCode: text("carc_code"),

    rarcCode: text("rarc_code"),

    amountCents: bigint("amount_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
);


export const eraMatchesTable = pgTable(
  "era_matches",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    eraClaimId: uuid("era_claim_id")
      .notNull()
      .references(() => eraClaimsTable.id, {
        onDelete: "cascade",
      }),

    claimId: uuid("claim_id")
      .references(
        () => professionalClaimsTable.id,
      ),

    matchStatus: text("match_status")
      .notNull()
      .default("unmatched"),

    confidence: numeric("confidence"),

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


/* =========================================================
   ADJUSTMENTS
   ========================================================= */

export const adjustmentsTable = pgTable(
  "adjustments",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, {
        onDelete: "cascade",
      }),

    clientId: uuid("client_id")
      .references(() => clientsTable.id),

    claimId: uuid("claim_id")
      .references(
        () => professionalClaimsTable.id,
      ),

    payerId: uuid("payer_id")
      .references(() => payersTable.id),

    adjustmentType: text(
      "adjustment_type",
    )
      .notNull(),

    adjustmentStatus: text(
      "adjustment_status",
    )
      .notNull()
      .default("posted"),

    adjustmentDate: date(
      "adjustment_date",
      {
        mode: "string",
      },
    ),

    amountCents: bigint("amount_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),

    reason: text("reason"),

    carcCode: text("carc_code"),

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
  },
);


export const adjustmentAllocationsTable =
  pgTable(
    "adjustment_allocations",
    {
      id: uuid("id")
        .primaryKey()
        .defaultRandom(),

      tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenantsTable.id, {
          onDelete: "cascade",
        }),

      adjustmentId: uuid(
        "adjustment_id",
      )
        .notNull()
        .references(
          () => adjustmentsTable.id,
          {
            onDelete: "cascade",
          },
        ),

      clientId: uuid("client_id")
        .references(() => clientsTable.id),

      claimId: uuid("claim_id")
        .references(
          () => professionalClaimsTable.id,
        ),

      claimLineId: uuid("claim_line_id")
        .references(
          () =>
            professionalClaimLinesTable.id,
        ),

      amountCents: bigint(
        "amount_cents",
        {
          mode: "number",
        },
      )
        .notNull()
        .default(0),

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


export const paymentReversalsTable =
  pgTable(
    "payment_reversals",
    {
      id: uuid("id")
        .primaryKey()
        .defaultRandom(),

      tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenantsTable.id, {
          onDelete: "cascade",
        }),

      paymentId: uuid("payment_id")
        .notNull()
        .references(
          () => paymentsTable.id,
          {
            onDelete: "cascade",
          },
        ),

      reason: text("reason")
        .notNull(),

      reversedBy: uuid("reversed_by"),

      createdAt: timestamp("created_at", {
        withTimezone: true,
      })
        .notNull()
        .defaultNow(),
    },
  );


export const adjustmentReversalsTable =
  pgTable(
    "adjustment_reversals",
    {
      id: uuid("id")
        .primaryKey()
        .defaultRandom(),

      tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenantsTable.id, {
          onDelete: "cascade",
        }),

      adjustmentId: uuid(
        "adjustment_id",
      )
        .notNull()
        .references(
          () => adjustmentsTable.id,
          {
            onDelete: "cascade",
          },
        ),

      reason: text("reason")
        .notNull(),

      reversedBy: uuid("reversed_by"),

      createdAt: timestamp("created_at", {
        withTimezone: true,
      })
        .notNull()
        .defaultNow(),
    },
  );
