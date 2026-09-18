import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const templatePanel = readFileSync(
  new URL(
    "../src/domains/credentialing/RequirementTemplatesPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918000000_credentialing_requirement_templates.sql",
    import.meta.url,
  ),
  "utf8",
);

test("credentialing exposes a payer requirement template library", () => {
  assert.match(credentialingPage, /\["payer_requirements", "Payer Requirements"\]/);
  assert.match(credentialingPage, /RequirementTemplatesPanel/);
  assert.match(templatePanel, /Credentialing Requirement Templates/);
  assert.match(templatePanel, /tenantSelect\("credentialing_requirement_templates"/);
  assert.match(templatePanel, /tenantSelect\("credentialing_requirement_template_items"/);
  assert.match(templatePanel, /tenantSelect\("payers"/);
  assert.match(templatePanel, /tenantSelect\("payer_plans"/);
  assert.match(templatePanel, /tenantInsert\("credentialing_requirement_templates"/);
  assert.match(templatePanel, /tenantInsert\("credentialing_requirement_template_items"/);
});

test("requirement templates match payer, optional product, application type, provider type and state", () => {
  assert.match(migration, /create table public\.credentialing_requirement_templates/i);
  assert.match(migration, /payer_id uuid not null/i);
  assert.match(migration, /payer_plan_id uuid/i);
  assert.match(migration, /application_type text/i);
  assert.match(migration, /provider_type text/i);
  assert.match(migration, /state text/i);
  assert.match(migration, /create table public\.credentialing_requirement_template_items/i);
  assert.match(migration, /requirement_key text not null/i);
  assert.match(migration, /due_offset_days integer/i);
});

test("matching templates populate only missing canonical case requirements", () => {
  assert.match(migration, /create or replace function public\.apply_matching_credentialing_requirement_templates/i);
  assert.match(migration, /private\.has_tenant_write_access/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /insert into public\.credentialing_requirements/i);
  assert.match(migration, /not exists[\s\S]*credentialing_requirements/i);
  assert.match(migration, /t\.payer_id = e\.payer_id/i);
  assert.match(migration, /t\.payer_plan_id is null[\s\S]*e\.payer_plan_id/i);
  assert.match(migration, /t\.application_type is null/i);
  assert.match(migration, /t\.provider_type is null/i);
  assert.match(migration, /t\.state is null/i);
  assert.doesNotMatch(migration, /create table public\.credentialing_case_requirements/i);
});

test("new cases auto-apply matching requirements and existing cases can reapply safely", () => {
  assert.match(migration, /create or replace function public\.create_credentialing_case/i);
  assert.match(migration, /apply_matching_credentialing_requirement_templates/i);
  assert.match(credentialingPage, /Apply Matching Templates/);
  assert.match(credentialingPage, /apply_matching_credentialing_requirement_templates/);
  assert.match(migration, /revoke all on function public\.apply_matching_credentialing_requirement_templates/i);
});
