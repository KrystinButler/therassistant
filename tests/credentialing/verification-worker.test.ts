import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entryPath = "supabase/functions/credentialing-verification-worker/index.ts";
const processorPath = "supabase/functions/credentialing-verification-worker/processor.ts";
const migrationPath = "supabase/migrations/20261007030000_credentialing_verification_worker.sql";

async function text(path: string) {
  return readFile(path, "utf8");
}

function functionBody(source: string, name: string, nextName: string) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("worker queue access stays behind service-role-only database RPCs", async () => {
  const migration = await text(migrationPath);
  assert.match(migration, /credentialing_worker_read_message/);
  assert.match(migration, /credentialing_worker_archive_message/);
  assert.match(migration, /credentialing_worker_retry_message/);
  assert.match(migration, /REVOKE ALL.*FROM PUBLIC/si);
  assert.match(migration, /GRANT EXECUTE.*TO service_role/si);
  assert.doesNotMatch(migration, /GRANT EXECUTE.*authenticated/si);
});

test("worker requires JWT and never converts source failure to NOT_FOUND", async () => {
  const [entry, processor] = await Promise.all([text(entryPath), text(processorPath)]);
  assert.match(entry, /authorization/i);
  assert.match(processor, /SOURCE_UNAVAILABLE/);
  assert.match(processor, /UNABLE_TO_VERIFY/);
  assert.doesNotMatch(processor, /SOURCE_UNAVAILABLE[^\n]{0,120}NOT_FOUND/);
});

test("worker archives terminal results and retries only bounded transient failures", async () => {
  const worker = await text(processorPath);
  assert.match(worker, /credentialing_worker_archive_message/);
  assert.match(worker, /credentialing_worker_retry_message/);
  assert.match(worker, /TRANSIENT_NETWORK/);
  assert.match(worker, /RATE_LIMITED/);
  assert.match(worker, /MAX_ATTEMPTS/);
  assert.match(worker, /read_ct/);
});

test("worker writes evidence before completing every verification decision", async () => {
  const worker = await text(processorPath);
  const unable = functionBody(worker, "completeUnable", "completeSynthetic");
  const synthetic = functionBody(worker, "completeSynthetic", "completeCigna");
  const cigna = functionBody(worker, "completeCigna", "processMessage");

  for (const completionPath of [unable, synthetic, cigna]) {
    const evidence = completionPath.indexOf("await recordEvidence");
    const completion = completionPath.indexOf("await patchRun");
    assert.ok(evidence >= 0, "completion path must persist evidence");
    assert.ok(completion > evidence, "evidence must be persisted before run completion");
  }

  assert.match(worker, /VERIFICATION_COMPLETED/);
});
