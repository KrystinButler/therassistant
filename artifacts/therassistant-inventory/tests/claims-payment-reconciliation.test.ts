import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyDenialPolicy } from "../src/domains/ar/denials";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../../../supabase/migrations/20260923090926_claims_payment_reconciliation_integrity.sql"),
  "utf8",
);
const archiveRepository = readFileSync(
  join(here, "../src/domains/billing/claim-artifact-repository.ts"),
  "utf8",
);
const reportsPage = readFileSync(
  join(here, "../src/pages/operational-workspaces.tsx"),
  "utf8",
);

test("configured credentialing CARCs all route to automatic write-off", () => {
  for (const carc of ["147","170","171","172","206","207","208","242","243","279"]) {
    assert.equal(classifyDenialPolicy("other", carc), "auto_writeoff", `CARC ${carc}`);
  }
});

test("manual payment retry protection and self-pay patient AR are atomic database behavior", () => {
  assert.match(migration, /payments_tenant_idempotency_uidx/);
  assert.match(migration, /p_idempotency_key text default null/);
  assert.match(migration, /v_client_ar/);
  assert.match(migration, /'1100','side','credit'/);
  assert.match(migration, /idempotent_replay/);
});

test("claim balance reconciliation excludes reversed voided and refunded payments", () => {
  assert.match(
    migration,
    /p\.payment_status not in \([\s\S]*?'reversed'[\s\S]*?'voided'[\s\S]*?'refunded'/,
  );
  assert.match(migration, /v_open := greatest\(0,[\s\S]*?- v_paid - v_reducing \+ v_recovery\)/);
});

test("corrected claims can re-batch after historical transmission but not while an outbound batch is pending", () => {
  assert.match(migration, /cb\.batch_status in \([\s\S]*?'created'[\s\S]*?'ready'/);
  assert.doesNotMatch(migration, /already belong to a batch/i);
});

test("archived 837P retrieval verifies stored bytes before any regeneration", () => {
  const archivedBranch = archiveRepository.indexOf("if (prepared.archived)");
  const regeneration = archiveRepository.indexOf("const output = await getBatchExportData(batchId)");
  assert.ok(archivedBranch >= 0);
  assert.ok(regeneration > archivedBranch);
  const archivedSection = archiveRepository.slice(archivedBranch, regeneration);
  assert.match(archivedSection, /readClaimEdiArtifact\(prepared\.storage_path\)/);
  assert.match(archivedSection, /archivedHash !== prepared\.sha256/);
  assert.match(archivedSection, /archivedBytes !== Number\(prepared\.byte_length\)/);
  assert.doesNotMatch(archivedSection, /build837PText/);
});

test("management reports exclude unreconciled claims and reversed payments from operational totals", () => {
  assert.match(reportsPage, /missingBalanceClaims/);
  assert.match(reportsPage, /reconciledClaims/);
  assert.match(reportsPage, /\["posted", "partially_applied"\]/);
  assert.match(reportsPage, /\["reversed", "voided"\]/);
  assert.match(reportsPage, /Excluded from A\/R denominator/);
  assert.match(reportsPage, /91\+ days from DOS/);
});
