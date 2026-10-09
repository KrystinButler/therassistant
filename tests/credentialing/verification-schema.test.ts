import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20261007005545_credentialing_verification_engine.sql";
const typesPath = "artifacts/api-server/src/modules/credentialing/types.ts";
const queuePath = "artifacts/api-server/src/modules/credentialing/queue.ts";

test("automated verification history is separate from the manual verification table", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? public\.participation_verification_runs/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? public\.participation_verification_matches/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? public\.participation_verification_evidence/i);
  assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)? public\.payer_adapter_health/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.participation_verifications/i);
  assert.doesNotMatch(sql, /DROP TABLE(?: IF EXISTS)? public\.participation_verifications/i);
});

test("verification runs use exactly the SPEC-1 result states and confidence values", async () => {
  const sql = await readFile(migrationPath, "utf8");

  for (const status of ["IN_PROGRESS", "PARTICIPATING", "NOT_FOUND", "UNABLE_TO_VERIFY"]) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.doesNotMatch(sql, /OUT_OF_NETWORK|NON_PARTICIPATING/i);

  for (const confidence of ["HIGH", "MEDIUM", "LOW"]) {
    assert.match(sql, new RegExp(`'${confidence}'`));
  }

  for (const field of [
    "source_type",
    "source_reference",
    "source_updated_at",
    "requested_at",
    "completed_at",
    "verified_at",
    "adapter_version",
    "matching_algorithm_version",
    "failure_code",
    "failure_detail",
  ]) {
    assert.match(sql, new RegExp(field, "i"));
  }
});

test("verification data is tenant-scoped and browser history is append-only", async () => {
  const sql = await readFile(migrationPath, "utf8");

  for (const table of [
    "participation_verification_runs",
    "participation_verification_matches",
    "participation_verification_evidence",
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ON public\\.${table}[\\s\\S]*FOR SELECT[\\s\\S]*TO authenticated[\\s\\S]*private\\.has_tenant_read_access\\(tenant_id\\)`, "i"));
  }

  assert.doesNotMatch(sql, /ON public\.participation_verification_(?:runs|matches|evidence)[\s\S]*FOR (?:UPDATE|DELETE)\s+TO authenticated/i);
  assert.match(sql, /REVOKE ALL ON public\.participation_verification_runs FROM anon, authenticated/i);
  assert.match(sql, /GRANT SELECT ON public\.participation_verification_runs TO authenticated/i);
});

test("verification evidence captures reproducible source provenance", async () => {
  const sql = await readFile(migrationPath, "utf8");

  for (const field of [
    "source_key",
    "source_type",
    "source_reference",
    "source_updated_at",
    "retrieved_at",
    "content_hash",
    "content_type",
    "adapter_version",
    "normalized_evidence",
    "raw_storage_path",
  ]) {
    assert.match(sql, new RegExp(field, "i"));
  }

  for (const field of ["match_type", "expected_value", "observed_value", "matched", "score", "source_reference"]) {
    assert.match(sql, new RegExp(field, "i"));
  }
});

test("durable verification queue remains server-only", async () => {
  const [sql, types, queue] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(typesPath, "utf8"),
    readFile(queuePath, "utf8"),
  ]);

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pgmq/i);
  assert.match(sql, /credentialing_participation_verification/);
  assert.doesNotMatch(sql, /pgmq_public/i);
  assert.match(sql, /REVOKE USAGE ON SCHEMA pgmq FROM anon, authenticated/i);

  assert.match(types, /export type CredentialingVerificationJob/);
  assert.match(types, /runId: string/);
  assert.match(types, /tenantId: string/);
  assert.match(queue, /enqueueVerification/);
  assert.match(queue, /pgmq\.send/);
  assert.match(queue, /credentialing_participation_verification/);
});
