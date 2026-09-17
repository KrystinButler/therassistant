import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function migration(name: string) {
  const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
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


test("portal policy hardening consolidates staff and patient read paths", () => {
  const sql = migration("secure_patient_portal_auth_hardening");
  assert.match(sql, /client_portal_access_created_by_idx/i);
  for (const legacyPolicy of [
    "appointments patient portal select",
    "balances patient portal select",
    "checkins patient portal select",
    "insurance patient portal select",
    "clients patient portal select",
    "documents patient portal select",
    "treatment plans patient portal select",
    "treatment goals patient portal select",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "${legacyPolicy}"`, "i"));
  }
  assert.match(sql, /private\.has_tenant_read_access\(tenant_id\)[\s\S]+private\.has_client_portal_access/i);
});

test("privileged portal bodies live in private schema behind invoker wrappers", () => {
  const sql = migration("secure_patient_portal_definer_isolation");
  for (const name of [
    "activate_my_client_portal_access",
    "revoke_client_portal_access",
    "get_my_portal_provider_summary",
  ]) {
    assert.match(sql, new RegExp(`private\\.${name}_impl`, "i"));
    assert.match(sql, new RegExp(`public\\.${name}[\\s\\S]+security invoker`, "i"));
  }
  assert.match(sql, /private\.activate_my_client_portal_access_impl\(\)[\s\S]+security definer/i);
  assert.match(sql, /private\.revoke_client_portal_access_impl\(p_client_id uuid\)[\s\S]+security definer/i);
  assert.match(sql, /private\.get_my_portal_provider_summary_impl\(\)[\s\S]+security definer/i);
});
