import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const failures = [];

for (const file of [
  "artifacts/api-server/src/routes/patient-portal.ts",
  "artifacts/therassistant-inventory/src/pages/patient-portal.tsx",
]) {
  if (!fs.existsSync(file)) {
    failures.push(
      `Missing ${file}`,
    );
  }
}

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL,
  });

  const result =
    await pool.query(`
      SELECT table_name

      FROM information_schema.tables

      WHERE
        table_schema = 'public'

        AND table_name = ANY($1)
    `, [[
      "client_checkins",
      "patient_journal_entries",
      "appointments",
      "client_insurance_policies"
    ]]);

  const found =
    new Set(
      result.rows.map(
        (row) =>
          row.table_name,
      ),
    );

  for (const table of [
    "client_checkins",
    "patient_journal_entries",
    "appointments",
    "client_insurance_policies",
  ]) {
    if (!found.has(table)) {
      failures.push(
        `Missing required table ${table}`,
      );
    }
  }

  await pool.end();
}

if (failures.length) {
  console.error(
    "EXPECTED RED TEST:",
  );

  failures.forEach(
    (failure) =>
      console.error(
        ` - ${failure}`,
      ),
  );

  process.exit(1);
}

console.log(
  "Patient portal test passed.",
);
