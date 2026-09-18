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

function functionStatement(sql: string, qualifiedName: string) {
  const marker = `create or replace function ${qualifiedName}(`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `missing function: ${qualifiedName}`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated function: ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

test("patient portal writes derive authorization from auth identity", () => {
  const sql = migration("secure_patient_portal_writes");

  assert.match(sql, /create or replace function public\.record_client_checkin/i);
  assert.match(sql, /create or replace function public\.portal_save_previsit_checkin/i);
  assert.match(sql, /create or replace function public\.portal_add_journal_entry/i);
  assert.match(sql, /private\.has_client_portal_access/i);
  assert.doesNotMatch(sql, /p_client_id\s+uuid/i);
});

test("check-in reuses the existing workflow instead of creating a second portal check-in RPC", () => {
  const sql = migration("secure_patient_portal_writes");
  assert.doesNotMatch(sql, /function public\.portal_record_checkin/i);

  const checkin = functionStatement(sql, "public.record_client_checkin");
  assert.match(checkin, /private\.record_client_checkin_impl/i);
  assert.match(checkin, /security invoker/i);
  assert.doesNotMatch(checkin, /security definer/i);
});

test("new patient write RPCs use private definer bodies and public invoker wrappers", () => {
  const sql = migration("secure_patient_portal_writes");

  for (const name of [
    "portal_save_previsit_checkin",
    "portal_add_journal_entry",
  ]) {
    const wrapper = functionStatement(sql, `public.${name}`);
    const impl = functionStatement(sql, `private.${name}_impl`);
    assert.match(wrapper, /security invoker/i);
    assert.doesNotMatch(wrapper, /security definer/i);
    assert.match(impl, /security definer/i);
  }

  assert.match(sql, /revoke all on function private\./i);
  assert.match(sql, /revoke all on function public\./i);
  assert.match(sql, /from public, anon/i);
});

test("previsit write accepts only the approved five fields", () => {
  const sql = migration("secure_patient_portal_writes");
  const impl = functionStatement(sql, "private.portal_save_previsit_checkin_impl");

  for (const field of [
    "demographics_confirmed",
    "insurance_confirmed",
    "visit_questions",
    "consents",
    "submitted",
  ]) {
    assert.match(impl, new RegExp(field, "i"));
  }
  assert.match(impl, /Unsupported pre-visit field/i);
});

test("journal write derives client identity and validates goal ownership", () => {
  const sql = migration("secure_patient_portal_writes");
  const impl = functionStatement(sql, "private.portal_add_journal_entry_impl");

  assert.match(impl, /client_portal_access/i);
  assert.match(impl, /user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(impl, /status\s*=\s*'active'/i);
  assert.match(impl, /Treatment goal is unavailable/i);
  assert.doesNotMatch(impl, /p_client_id\s+uuid/i);
});
