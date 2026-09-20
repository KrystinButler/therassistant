import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import * as paymentOperations from "../src/domains/payments/operations.ts";
import * as paymentWorkflow from "../src/domains/payments/workflow.ts";
import { sourceRouteForWorkItem } from "../src/domains/work-center/repository.ts";

const paymentRepositorySource = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const atomicPostingMigrationUrl = new URL(
  "../../../supabase/migrations/20260920122438_production_payment_posting.sql",
  import.meta.url,
);

test("manual payment posting uses one tenant-scoped database transaction", () => {
  assert.equal(existsSync(atomicPostingMigrationUrl), true);
  if (!existsSync(atomicPostingMigrationUrl)) return;

  const sql = readFileSync(atomicPostingMigrationUrl, "utf8");
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.post_manual_payment/i);
  assert.match(sql, /security\s+invoker/i);
  assert.match(sql, /assert_tenant_access\(p_tenant_id\)/i);
  assert.match(sql, /insert\s+into\s+public\.payments/i);
  assert.match(sql, /insert\s+into\s+public\.payment_allocations/i);
  assert.match(sql, /update\s+public\.professional_claims/i);
  assert.match(sql, /patient_responsibility_cents/);
  assert.match(sql, /insurance_responsibility_cents/);
  assert.match(sql, /least\(v_allocation,\s*v_open,\s*v_source_open,\s*p_amount_cents\)/i);
  assert.match(sql, /create_ledger_transaction/i);
  assert.match(sql, /'1100'/);
  assert.match(sql, /'2100'/);
  assert.match(sql, /'2110'/);

  const manualSection = paymentRepositorySource.split("export async function postManualPayment")[1]?.split("export async function reversePayment")[0] ?? "";
  assert.match(manualSection, /tenantRpc<ManualPaymentResult>\("post_manual_payment"/);
  assert.match(manualSection, /p_tenant_id:\s*tenantId/);
  assert.doesNotMatch(manualSection, /post_demo_manual_payment/);
  assert.doesNotMatch(manualSection, /tenantInsert<DataRow>\("payments"/);
  assert.doesNotMatch(manualSection, /tenantInsert<DataRow>\("payment_allocations"/);
});

test("adjudicated balances preserve independent patient and insurance portions", () => {
  const partition = (paymentWorkflow as Record<string, unknown>).partitionAdjudicatedBalance as
    | ((openBalanceCents: number, patientResponsibilityCents: number, patientPaidCents?: number) => {
      patientResponsibilityCents: number;
      insuranceResponsibilityCents: number;
    })
    | undefined;

  assert.equal(typeof partition, "function");
  if (!partition) return;
  assert.deepEqual(partition(3000, 1000), {
    patientResponsibilityCents: 1000,
    insuranceResponsibilityCents: 2000,
  });
  assert.deepEqual(partition(2000, 1000, 1000), {
    patientResponsibilityCents: 0,
    insuranceResponsibilityCents: 2000,
  });
});

test("reversed and voided payments have no available unapplied balance", () => {
  const summarize = (paymentOperations as Record<string, unknown>).summarizePaymentBalance as
    | ((status: unknown, amountCents: number, allocatedCents: number) => {
      allocatedCents: number;
      unappliedCents: number;
    })
    | undefined;

  assert.equal(typeof summarize, "function");
  if (!summarize) return;
  assert.deepEqual(summarize("reversed", 5000, 0), { allocatedCents: 0, unappliedCents: 0 });
  assert.deepEqual(summarize("voided", 5000, 0), { allocatedCents: 0, unappliedCents: 0 });
  assert.deepEqual(summarize("partially_applied", 5000, 2000), { allocatedCents: 2000, unappliedCents: 3000 });
});

test("denial work items open the actionable denial workspace", () => {
  assert.equal(sourceRouteForWorkItem("denial", "denial-1"), "/ar-denials?tab=denials");
});
