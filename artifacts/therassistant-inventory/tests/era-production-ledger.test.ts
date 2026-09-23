import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositorySource = readFileSync(
  fileURLToPath(new URL("../src/domains/payments/repository.ts", import.meta.url)),
  "utf8",
);
const workflowSource = readFileSync(
  fileURLToPath(new URL("../src/domains/payments/workflow.ts", import.meta.url)),
  "utf8",
);

test("ERA import uses production ledger RPCs instead of direct payment writes", () => {
  assert.match(repositorySource, /post_era_payment_receipt/);
  assert.match(repositorySource, /allocate_payment/);
  assert.match(repositorySource, /post_contractual_adjustment/);

  const eraStart = workflowSource.indexOf("export async function import835Workflow");
  const eraSource = workflowSource.slice(eraStart);

  assert.match(eraSource, /postEraPaymentReceipt/);
  assert.match(eraSource, /allocatePayment/);
  assert.match(eraSource, /postContractualAdjustment/);
  assert.doesNotMatch(eraSource, /repo\.createPayment\(/);
  assert.doesNotMatch(eraSource, /repo\.createPaymentAllocation\(/);
  assert.doesNotMatch(eraSource, /repo\.createAdjustmentAllocation\(/);
});

test("ERA ledger migration preserves 835 payment date and contractual adjustment ledger", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../../supabase/migrations/20260920192102_era_production_ledger_posting.sql", import.meta.url)),
    "utf8",
  );

  assert.match(migration, /post_era_payment_receipt/);
  assert.match(migration, /coalesce\(p_payment_date, current_date\)/);
  assert.match(migration, /'2110'/);
  assert.match(migration, /post_contractual_adjustment/);
  assert.match(migration, /'4020'/);
  assert.match(migration, /'1100'/);
  assert.match(migration, /security invoker/i);
});
