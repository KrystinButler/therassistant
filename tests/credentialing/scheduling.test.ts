import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20261007040000_credentialing_maintenance_scheduler.sql";
const directoryMonitorPath = "supabase/functions/credentialing-directory-monitor/index.ts";
const workerPath = "supabase/functions/credentialing-verification-worker/index.ts";
const catalogPath = "supabase/functions/credentialing-catalog-sync/index.ts";
const supabaseConfigPath = "supabase/config.toml";
const restoreDrillPath = "scripts/verify-local-restore-drill.sh";

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

test("maintenance Edge Functions disable gateway JWT verification because custom scheduler auth runs inside the function", async () => {
  const config = await text(supabaseConfigPath);
  for (const slug of [
    "credentialing-verification-worker",
    "credentialing-catalog-sync",
    "credentialing-directory-monitor",
  ]) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      config,
      new RegExp(`\\[functions\\.${escaped}\\]\\s+verify_jwt\\s*=\\s*false`, "m"),
    );
  }
});

test("restore rehearsal excludes database-bound pg_cron metadata and cron schema only", async () => {
  const script = await text(restoreDrillPath);
  assert.match(script, /pg_dump[\s\S]*--exclude-schema=cron/);
  assert.match(script, /pg_restore\s+.*--list/s);
  assert.match(script, /EXTENSION - pg_cron\\\(\[\[:space:\]\]\\\|\$\\\)/);
  assert.match(script, /COMMENT - EXTENSION pg_cron\\\(\[\[:space:\]\]\\\|\$\\\)/);
  assert.match(script, /--use-list/);
  assert.doesNotMatch(script, /--exclude-table=.*credentialing|--exclude-schema=.*credentialing/i);
});

test("directory monitor refreshes NPPES snapshots without changing manual credentialing state", async () => {
  const source = await text(directoryMonitorPath);
  assert.match(source, /npiregistry\.cms\.hhs\.gov\/api/);
  assert.match(source, /credentialing_directory_snapshots/);
  assert.match(source, /credentialing_directory_discrepancies/);
  assert.doesNotMatch(source, /provider_payer_enrollments[^\n]{0,100}(PATCH|UPDATE)|professional_claims|claim_status/i);
});
