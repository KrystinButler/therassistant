import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function migration(name: string) {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${name}.sql`));
  assert.ok(file, `missing migration: ${name}`);
  return readFileSync(join(dir, file), "utf8");
}

test("secure patient portal migration defines mapped identity and active-only access", () => {
  const sql = migration("secure_patient_portal_auth");
  assert.match(sql, /create table public\.client_portal_access/i);
  assert.match(sql, /references auth\.users\s*\(id\)/i);
  assert.match(sql, /private\.has_client_portal_access/i);
  assert.match(sql, /status\s*=\s*'active'/i);
  assert.match(sql, /get_my_client_portal_context/i);
  assert.match(sql, /activate_my_client_portal_access/i);
  assert.match(sql, /get_patient_portal_invite_context/i);
  assert.match(sql, /revoke_client_portal_access/i);
  assert.match(sql, /get_my_portal_provider_summary/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon/i);
});

test("patient read policies cover only the approved portal tables", () => {
  const sql = migration("secure_patient_portal_auth");
  for (const table of [
    "clients",
    "appointments",
    "client_insurance_policies",
    "documents",
    "client_checkins",
    "patient_journal_entries",
    "client_balance_summaries",
    "treatment_plans",
    "treatment_plan_goals",
  ]) {
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated`, "i"));
  }

  assert.doesNotMatch(sql, /on public\.providers for select to authenticated[\s\S]*has_client_portal_access/i);
  assert.doesNotMatch(sql, /on public\.clinical_notes for select to authenticated[\s\S]*has_client_portal_access/i);
  assert.doesNotMatch(sql, /on public\.professional_claims for select to authenticated[\s\S]*has_client_portal_access/i);
});

test("provider portal surface is a narrow summary instead of full provider row access", () => {
  const sql = migration("secure_patient_portal_auth");
  assert.match(sql, /get_my_portal_provider_summary\(\)/i);
  assert.match(sql, /'id'.*'first_name'.*'last_name'.*'credentials'.*'primary_specialty'/is);
  assert.doesNotMatch(sql, /grant select on public\.providers to authenticated/i);
});
