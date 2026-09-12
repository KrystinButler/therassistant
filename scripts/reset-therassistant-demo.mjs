import {
  execFileSync,
} from "node:child_process";

import {
  existsSync,
} from "node:fs";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required.",
  );
}


const __filename =
  fileURLToPath(
    import.meta.url,
  );

const workspace =
  resolve(
    dirname(__filename),
    "..",
  );


const pool =
  new Pool({
    connectionString:
      process.env.DATABASE_URL,
  });


/*
 * Inventory data is intentionally preserved.
 *
 * Everything below is synthetic operational
 * demonstration data and may be reset.
 */
const resetTables = [
  "refunds",
  "overpayment_reviews",
  "claim_follow_up_actions",
  "payer_timely_filing_rules",

  "submission_responses",
  "claim_submissions",
  "claim_batch_items",
  "claim_batches",

  "journal_provider_reviews",
  "patient_journal_entries",

  "import_validation_errors",
  "import_rows",
  "import_batches",

  "mailroom_items",

  "phi_access_logs",
  "audit_logs",
  "tenant_user_roles",
  "tenant_users",
  "user_profiles",

  "medicaid_coding_rules",
  "medicaid_programs",

  "billing_company_practice_links",
  "payer_aliases",
  "provider_payer_enrollments",
  "provider_identifiers",

  "adjustment_reversals",
  "payment_reversals",
  "adjustment_allocations",
  "adjustments",

  "era_matches",
  "era_adjustments",
  "era_service_lines",
  "era_claims",
  "era_files",

  "fee_schedule_lines",
  "fee_schedules",
  "payer_contracts",

  "workqueue_history",
  "workqueue_items",

  "payment_allocations",
  "payments",

  "appeals",
  "denials",

  "claim_balance_summaries",
  "claim_status_history",
  "claim_notes",
  "claim_diagnoses",
  "professional_claim_lines",
  "professional_claims",

  "charge_capture_items",
  "clinical_note_signatures",
  "clinical_notes",
  "treatment_plan_goals",
  "treatment_plans",
  "appointments",

  "authorization_units",
  "authorizations",
  "eligibility_benefits",
  "eligibility_checks",
  "client_balance_summaries",
  "client_checkins",
  "client_diagnoses",

  "client_insurance_policies",

  "payer_plans",
  "payers",

  "providers",
  "clients",
  "tenants",
];


const client =
  await pool.connect();

try {
  const existingResult =
    await client.query(
      `
        SELECT table_name

        FROM information_schema.tables

        WHERE
          table_schema = 'public'

          AND table_name =
            ANY($1)
      `,
      [
        resetTables,
      ],
    );


  const existing =
    new Set(
      existingResult.rows.map(
        (row) =>
          row.table_name,
      ),
    );


  const tables =
    resetTables.filter(
      (table) =>
        existing.has(table),
    );


  if (tables.length) {
    const quoted =
      tables.map(
        (table) =>
          `"${table.replaceAll(
            '"',
            '""',
          )}"`,
      );


    console.log(
      `Resetting ${tables.length} synthetic demo tables...`,
    );


    await client.query(
      `TRUNCATE TABLE ${quoted.join(
        ", ",
      )} RESTART IDENTITY CASCADE`,
    );
  }
} finally {
  client.release();

  await pool.end();
}


const seedScripts = [
  "seed-therassistant-demo.mjs",
  "seed-therassistant-readiness.mjs",
  "seed-therassistant-charge-demo.mjs",
  "seed-therassistant-remittance.mjs",
  "seed-therassistant-credentialing.mjs",
  "seed-therassistant-mailroom-imports.mjs",
  "seed-therassistant-journal.mjs",
  "seed-therassistant-claim-submission.mjs",
  "seed-therassistant-compliance.mjs",
  "seed-therassistant-claim-followup.mjs",
  "seed-therassistant-medicaid-tools.mjs",
  "seed-therassistant-patient-portal.mjs",
];


for (const name of seedScripts) {
  const file =
    join(
      workspace,
      "scripts",
      name,
    );


  if (!existsSync(file)) {
    throw new Error(
      `Required demo seed is missing: ${name}`,
    );
  }


  console.log("");
  console.log(
    `=== ${name} ===`,
  );


  execFileSync(
    process.execPath,
    [
      file,
    ],
    {
      cwd:
        workspace,

      stdio:
        "inherit",

      env:
        process.env,
    },
  );
}


console.log("");
console.log(
  "Synthetic Therassistant demo reset complete.",
);
