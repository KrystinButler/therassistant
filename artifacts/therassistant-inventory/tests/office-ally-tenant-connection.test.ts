import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationDir = path.resolve(process.cwd(), "../supabase/migrations");
const migrationNames = fs.readdirSync(migrationDir)
  .filter((name) => /^\d+_tenant_office_ally_connections\.sql$/.test(name));
const migrationPath = path.join(migrationDir, migrationNames[0] ?? "missing.sql");
const migration = fs.existsSync(migrationPath)
  ? fs.readFileSync(migrationPath, "utf8")
  : "";

test("tenant Office Ally migration exists and stores only a Vault reference", () => {
  assert.equal(migrationNames.length, 1);
  assert.equal(fs.existsSync(migrationPath), true);
  assert.match(migration, /create table(?: if not exists)? public\.tenant_edi_connections/i);
  assert.match(migration, /unique\s*\(\s*tenant_id\s*,\s*provider\s*\)/i);
  assert.match(migration, /credential_secret_id\s+uuid/i);
  const tableBlock = migration.match(/create table(?: if not exists)? public\.tenant_edi_connections[\s\S]*?\);/i)?.[0] ?? "";
  assert.doesNotMatch(tableBlock, /credentials?\s+jsonb/i);
  assert.doesNotMatch(tableBlock, /password|api_key|auth_value/i);
});

test("credential save replaces the tenant Vault secret and restricts mutation to admins", () => {
  assert.match(migration, /vault\.create_secret\s*\(/i);
  assert.match(migration, /vault\.update_secret\s*\(/i);
  assert.match(migration, /private\.has_tenant_admin_access\(p_tenant_id\)/i);
  assert.match(migration, /unsupported Office Ally environment/i);
  assert.match(migration, /p_environment[\s\S]*?test[\s\S]*?production/i);
});

test("browser-safe status RPC never returns the Vault secret reference or credential JSON", () => {
  assert.match(migration, /get_office_ally_connection_status\s*\(/i);
  assert.match(migration, /save_office_ally_connection\s*\(/i);
  assert.match(migration, /disconnect_office_ally_connection\s*\(/i);
  const statusFunction = migration.match(/create or replace function public\.get_office_ally_connection_status[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(statusFunction, /provider/i);
  assert.match(statusFunction, /environment/i);
  assert.match(statusFunction, /account_label/i);
  assert.match(statusFunction, /credential_profile/i);
  assert.match(statusFunction, /last_verified_at/i);
  assert.match(statusFunction, /last_error/i);
  assert.doesNotMatch(statusFunction, /credential_secret_id|decrypted_secret|p_credentials/i);
});

test("tenant connection table has no direct authenticated write policy", () => {
  assert.match(migration, /alter table public\.tenant_edi_connections enable row level security/i);
  assert.match(migration, /revoke all on table public\.tenant_edi_connections from anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy[\s\S]{0,200}tenant_edi_connections[\s\S]{0,200}for\s+(?:insert|update|delete|all)\s+to\s+authenticated/i);
});

test("synthetic test readiness never deletes an existing production credential", () => {
  const saveFunction = migration.match(/create or replace function public\.save_office_ally_connection[\s\S]*?\$\$;/i)?.[0] ?? "";
  const disconnectFunction = migration.match(/create or replace function public\.disconnect_office_ally_connection[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.doesNotMatch(saveFunction, /delete from vault\.secrets/i);
  assert.match(disconnectFunction, /delete from vault\.secrets/i);
});

test("server-only resolver can decrypt only the tenant production secret", () => {
  assert.match(migration, /resolve_office_ally_connection_secret\s*\(p_tenant_id uuid\)/i);
  assert.match(migration, /vault\.decrypted_secrets/i);
  assert.match(migration, /credential_secret_id/i);
  assert.match(migration, /environment\s*=\s*'production'/i);
  assert.match(migration, /enabled\s*=\s*true/i);
  assert.match(migration, /revoke all on function public\.resolve_office_ally_connection_secret\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.resolve_office_ally_connection_secret\(uuid\) to service_role/i);
});

test("Office Ally gateway separates zero-network test mode from tenant production credentials", () => {
  const helperPath = path.resolve(process.cwd(), "../supabase/functions/_shared/office-ally-connection.ts");
  const edgePath = path.resolve(process.cwd(), "../supabase/functions/office-ally-edi/index.ts");
  assert.equal(fs.existsSync(helperPath), true);
  const helper = fs.readFileSync(helperPath, "utf8");
  const edge = fs.readFileSync(edgePath, "utf8");

  assert.match(helper, /resolveOfficeAllyConnection/);
  assert.match(helper, /authorization_api_key/);
  assert.match(helper, /credentials\.apiKey/);
  assert.match(helper, /resolve_office_ally_connection_secret/);
  assert.doesNotMatch(helper, /OFFICE_ALLY_AUTH_VALUE/);

  const testBranch = edge.indexOf('environment === "test"');
  const routeCall = edge.indexOf("configuredRoute(transaction)");
  const fetchCall = edge.indexOf("await fetch(");
  assert.ok(testBranch >= 0 && routeCall > testBranch && fetchCall > testBranch);
  assert.match(edge, /synthetic:\s*true/);
  assert.match(edge, /synthetic:\s*false/);
  assert.match(edge, /Authorization/);
  assert.doesNotMatch(edge, /OFFICE_ALLY_AUTH_VALUE/);
  assert.match(edge, /\/v2\/eligibility/);
  assert.match(edge, /\/v2\/claim-status/);
});
