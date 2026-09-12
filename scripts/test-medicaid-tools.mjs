import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const failures = [];

for (const file of [
  "artifacts/api-server/src/routes/medicaid.ts",
  "artifacts/therassistant-inventory/src/pages/medicaid-tools.tsx",
]) {
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${file}`);
  }
}

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL,
  });

  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
  `, [[
    "medicaid_programs",
    "medicaid_coding_rules"
  ]]);

  const found = new Set(
    result.rows.map(
      (row) => row.table_name,
    ),
  );

  for (const table of [
    "medicaid_programs",
    "medicaid_coding_rules",
  ]) {
    if (!found.has(table)) {
      failures.push(
        `Missing table ${table}`,
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
  "Medicaid tools test passed.",
);
