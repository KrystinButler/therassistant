import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918044103_credentialing_requirement_templates.sql",
    import.meta.url,
  ),
  "utf8",
);

test("credentialing exposes reusable requirement template management", () => {
  assert.match(credentialingPage, /\["templates", "Requirement Templates"\]/);
  assert.match(credentialingPage, /credentialing_requirement_templates/);
  assert.match(credentialingPage, /credentialing_requirement_template_items/);
  assert.match(credentialingPage, /referenceSelect\("payers"/);
  assert.match(credentialingPage, /referenceSelect\("payer_plans"/);
  assert.match(credentialingPage, /Create Template/);
  assert.match(credentialingPage, /Add Requirement/);
});

test("requirement template tables are tenant-scoped and RLS protected", () => {
  assert.match(migration, /create table public\.credentialing_requirement_templates/i);
  assert.match(migration, /create table public\.credentialing_requirement_template_items/i);
  assert.match(migration, /alter table public\.credentialing_requirement_templates enable row level security/i);
  assert.match(migration, /alter table public\.credentialing_requirement_template_items enable row level security/i);
  assert.match(migration, /private\.has_tenant_read_access\(tenant_id\)/i);
  assert.match(migration, /private\.has_tenant_write_access\(tenant_id\)/i);
  assert.match(migration, /revoke all on table public\.credentialing_requirement_templates from public, anon/i);
  assert.match(migration, /revoke all on table public\.credentialing_requirement_template_items from public, anon/i);
});

test("templates match payer and optional product application provider and state scope", () => {
  assert.match(migration, /payer_id uuid not null/i);
  assert.match(migration, /payer_plan_id uuid/i);
  assert.match(migration, /application_type text/i);
  assert.match(migration, /provider_type text/i);
  assert.match(migration, /state text/i);
  assert.match(migration, /requirement_key text not null/i);
  assert.match(migration, /due_offset_days integer/i);
});

test("matching templates populate only missing canonical case requirements", () => {
  assert.match(migration, /create or replace function public\.apply_matching_credentialing_requirement_templates/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /insert into public\.credentialing_requirements/i);
  assert.match(migration, /where not exists[\s\S]*public\.credentialing_requirements/i);
  assert.match(migration, /cr\.requirement_key = c\.requirement_key/i);
  assert.doesNotMatch(migration, /create table public\.credentialing_case_requirements/i);
});

test("new cases auto-apply templates and existing cases can apply missing items safely", () => {
  assert.match(migration, /create or replace function public\.create_credentialing_case/i);
  assert.match(migration, /perform public\.apply_matching_credentialing_requirement_templates/i);
  assert.match(credentialingPage, /Apply Matching Templates/);
  assert.match(credentialingPage, /apply_matching_credentialing_requirement_templates/);
  assert.match(credentialingPage, /No new matching template requirements were needed/);
});
