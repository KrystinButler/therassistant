import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20261007040000_credentialing_maintenance_scheduler.sql";
const directoryMonitorPath = "supabase/functions/credentialing-directory-monitor/index.ts";
const workerPath = "supabase/functions/credentialing-verification-worker/index.ts";
const catalogPath = "supabase/functions/credentialing-catalog-sync/index.ts";

async function text(path: string) {
  return readFile(path, "utf8");
}

test("maintenance scheduler uses pg_cron pg_net and Vault without embedding credentials", async () => {
  const sql = await text(migrationPath);
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_cron/i);
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_net/i);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /therassistant_credentialing_scheduler/);
  assert.match(sql, /credentialing-verification-worker/);
  assert.match(sql, /credentialing-catalog-sync/);
  assert.match(sql, /credentialing-directory-monitor/);
  assert.doesNotMatch(sql, /sb_secret_|eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(sql, /(?:authorization|apikey)\s*[:=][^\n]*(?:service_role|secret|bearer)/i);
});

test("maintenance functions require a custom scheduler secret rather than a public JWT", async () => {
  for (const path of [workerPath, catalogPath, directoryMonitorPath]) {
    const source = await text(path);
    assert.match(source, /x-therassistant-scheduler-secret/i);
    assert.match(source, /credentialing_internal_secret_valid/);
  }
});

test("directory monitor refreshes NPPES snapshots without changing manual credentialing state", async () => {
  const source = await text(directoryMonitorPath);
  assert.match(source, /npiregistry\.cms\.hhs\.gov\/api/);
  assert.match(source, /credentialing_directory_snapshots/);
  assert.match(source, /credentialing_directory_discrepancies/);
  assert.doesNotMatch(source, /provider_payer_enrollments[^\n]{0,100}(PATCH|UPDATE)|professional_claims|claim_status/i);
});
