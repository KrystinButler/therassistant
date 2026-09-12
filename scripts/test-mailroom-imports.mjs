import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const failures = [];

for (const file of [
  "artifacts/api-server/src/routes/mailroom.ts",
  "artifacts/api-server/src/routes/imports.ts",
  "artifacts/therassistant-inventory/src/pages/mailroom.tsx",
  "artifacts/therassistant-inventory/src/pages/imports.tsx",
]) {
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${file}`);
  }
}

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
  `, [[
    "mailroom_items",
    "import_batches",
    "import_rows",
    "import_validation_errors",
  ]]);

  const found = new Set(
    result.rows.map((row) => row.table_name),
  );

  for (const table of [
    "mailroom_items",
    "import_batches",
    "import_rows",
    "import_validation_errors",
  ]) {
    if (!found.has(table)) {
      failures.push(`Missing table ${table}`);
    }
  }

  await pool.end();
}

if (failures.length) {
  console.error("EXPECTED RED TEST:");
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log("Mailroom/import test passed.");
