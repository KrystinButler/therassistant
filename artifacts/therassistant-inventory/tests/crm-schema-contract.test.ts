import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260921072216_add_therassistant_crm.sql", import.meta.url),
  "utf8",
);

const tables = [
  "crm_accounts",
  "crm_calls",
  "crm_notes",
  "crm_documents",
  "crm_payment_plans",
  "crm_payment_plan_versions",
  "crm_installments",
  "crm_payment_allocations",
  "crm_payment_links",
  "crm_activity",
];

test("CRM migration defines required tables and RLS", () => {
  for (const table of tables) {
    assert.match(migration, new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("CRM migration links payments and creates private storage bucket", () => {
  assert.match(migration, /add column if not exists crm_account_id uuid/i);
  assert.match(migration, /insert into storage\.buckets/i);
  assert.match(migration, /'crm-documents'/i);
  assert.match(migration, /public\s*,\s*file_size_limit/i);
  assert.match(migration, /false,\s*20971520/is);
});

test("CRM migration adds foreign-key indexes and locks down browser roles", () => {
  assert.match(migration, /create index crm_calls_account_id_idx.*account_id/is);
  assert.match(migration, /create index crm_installments_plan_id_idx.*plan_id/is);
  assert.match(migration, /revoke all on table public\.crm_accounts from anon, authenticated/i);
});
