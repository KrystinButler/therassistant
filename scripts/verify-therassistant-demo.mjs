import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const failures = [];

const appPath =
  "artifacts/therassistant-inventory/src/App.tsx";

const app =
  fs.readFileSync(
    appPath,
    "utf8",
  );


const requiredRoutes = [
  "/work-center",
  "/clients",
  "/schedule",
  "/clinical",
  "/eligibility",
  "/charges",
  "/claims",
  "/payments",
  "/ar-denials",
  "/credentialing",
  "/payers-contracts",
  "/mailroom",
  "/reports",
  "/administration",
  "/demo",
  "/medicaid",
  "/journal",
  "/claims/submission",
  "/claims/follow-up",
  "/patient-portal/:clientId",
];


for (const route of requiredRoutes) {
  if (
    !app.includes(
      `path="${route}"`,
    )
  ) {
    failures.push(
      `Frontend route missing: ${route}`,
    );
  }
}


if (
  app.includes(
    "<ModulePlaceholder",
  )
) {
  failures.push(
    "App.tsx still renders ModulePlaceholder.",
  );
}


const routeDir =
  "artifacts/api-server/src/routes";

for (
  const file of fs.readdirSync(
    routeDir,
  )
) {
  if (
    !file.endsWith(".ts")
  ) {
    continue;
  }

  const source =
    fs.readFileSync(
      `${routeDir}/${file}`,
      "utf8",
    );

  if (
    /router\.(get|post|put|patch|delete)\(\s*["']\/api\//m.test(
      source,
    )
  ) {
    failures.push(
      `Duplicated /api prefix in ${file}`,
    );
  }
}


if (!process.env.DATABASE_URL) {
  failures.push(
    "DATABASE_URL is unavailable.",
  );
} else {
  const pool =
    new Pool({
      connectionString:
        process.env.DATABASE_URL,
    });


  const requiredTables = [
    "tenants",
    "clients",
    "providers",
    "appointments",
    "clinical_notes",
    "charge_capture_items",
    "professional_claims",
    "payments",
    "denials",
    "workqueue_items",
    "provider_payer_enrollments",
    "mailroom_items",
    "patient_journal_entries",
    "claim_batches",
    "overpayment_reviews",
    "medicaid_programs",
    "client_checkins",
    "audit_logs",
    "phi_access_logs",
  ];


  const tableResult =
    await pool.query(
      `
        SELECT table_name

        FROM information_schema.tables

        WHERE
          table_schema = 'public'

          AND table_name =
            ANY($1)
      `,
      [
        requiredTables,
      ],
    );


  const foundTables =
    new Set(
      tableResult.rows.map(
        (row) =>
          row.table_name,
      ),
    );


  for (
    const table of requiredTables
  ) {
    if (
      !foundTables.has(table)
    ) {
      failures.push(
        `Database table missing: ${table}`,
      );
    }
  }


  const counts =
    await pool.query(`
      SELECT
        (
          SELECT COUNT(*)
          FROM tenants
        )::int AS tenants,

        (
          SELECT COUNT(*)
          FROM clients
        )::int AS clients,

        (
          SELECT COUNT(*)
          FROM providers
        )::int AS providers,

        (
          SELECT COUNT(*)
          FROM professional_claims
        )::int AS claims,

        (
          SELECT COUNT(*)
          FROM workqueue_items
        )::int AS work_items,

        (
          SELECT COUNT(*)
          FROM patient_journal_entries
        )::int AS journal_entries,

        (
          SELECT COUNT(*)
          FROM mailroom_items
        )::int AS mailroom_items,

        (
          SELECT COUNT(*)
          FROM provider_payer_enrollments
        )::int AS enrollments,

        (
          SELECT COUNT(*)
          FROM medicaid_programs
        )::int AS medicaid_programs
    `);


  const row =
    counts.rows[0];


  const minimums = {
    tenants: 3,
    clients: 4,
    providers: 2,
    claims: 4,
    work_items: 1,
    journal_entries: 3,
    mailroom_items: 3,
    enrollments: 5,
    medicaid_programs: 1,
  };


  for (
    const [
      field,
      minimum,
    ] of Object.entries(
      minimums,
    )
  ) {
    if (
      Number(
        row[field] ?? 0,
      ) < minimum
    ) {
      failures.push(
        `${field} expected >= ${minimum}; found ${row[field] ?? 0}`,
      );
    }
  }


  console.log("");
  console.log(
    "=== DEMO DATA COUNTS ===",
  );

  console.table([
    row,
  ]);


  const stories =
    await pool.query(`
      SELECT
        c.first_name || ' ' ||
        c.last_name AS client,

        COUNT(
          DISTINCT pc.id
        )::int AS claims,

        COUNT(
          DISTINCT d.id
        )::int AS denials,

        COUNT(
          DISTINCT ci.id
        )::int AS checkins,

        COUNT(
          DISTINCT pje.id
        )::int AS journals

      FROM clients c

      LEFT JOIN professional_claims pc
        ON pc.client_id =
          c.id

      LEFT JOIN denials d
        ON d.client_id =
          c.id

      LEFT JOIN client_checkins ci
        ON ci.client_id =
          c.id

      LEFT JOIN patient_journal_entries pje
        ON pje.client_id =
          c.id

      GROUP BY c.id

      ORDER BY c.last_name
    `);


  console.log("");
  console.log(
    "=== DEMO STORY COVERAGE ===",
  );

  console.table(
    stories.rows,
  );


  await pool.end();
}


if (failures.length) {
  console.error("");
  console.error(
    "DEMO INTEGRITY CHECK FAILED:",
  );

  failures.forEach(
    (failure) =>
      console.error(
        ` - ${failure}`,
      ),
  );

  process.exit(1);
}


console.log("");
console.log(
  "PASS: Therassistant demo integrity checks passed.",
);
