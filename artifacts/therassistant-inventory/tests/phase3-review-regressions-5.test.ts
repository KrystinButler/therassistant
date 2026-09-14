import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { postDemoEraWorkflow, type PaymentRepository } from "../src/domains/payments/workflow.ts";
import { phase3BillingScenarios } from "../src/domains/demo/phase3-scenarios.ts";

const paymentRepositorySource = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const atomicReversalMigrationUrl = new URL(
  "../../../supabase/migrations/20260913_phase3_atomic_demo_payment_reversal.sql",
  import.meta.url,
);
const patientArSeedSource = readFileSync(
  new URL("../../../supabase/seed/2026-09-13-phase3-patient-ar-demo.sql", import.meta.url),
  "utf8",
);

type Row = Record<string, any> & { id: string };

function makeEraRepo() {
  const claims = new Map<string, Row>([
    ["claim-1", {
      id: "claim-1",
      claim_status: "accepted",
      client_id: "client-1",
      payer_id: "payer-1",
      total_charge_cents: 12000,
      patient_control_number: "PATIENT-AR-1",
      metadata: { synthetic: true },
    }],
  ]);
  const adjustments: Row[] = [];
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;
  const repo: PaymentRepository = {
    async getClaim(claimId) { return claims.get(claimId) ?? null; },
    async createPayment(values) { return { id: id("payment"), ...values }; },
    async updatePayment(paymentId, values) { return { id: paymentId, ...values }; },
    async createPaymentAllocation(values) { return { id: id("allocation"), ...values }; },
    async createAdjustment(values) { const row = { id: id("adjustment"), ...values }; adjustments.push(row); return row; },
    async createAdjustmentAllocation(values) { return { id: id("adjustment-allocation"), ...values }; },
    async createEraFile(values) { return { id: id("era-file"), ...values }; },
    async createEraClaim(values) { return { id: id("era-claim"), ...values }; },
    async createEraMatch(values) { return { id: id("era-match"), ...values }; },
    async updateEraFile(eraFileId, values) { return { id: eraFileId, ...values }; },
    async updateClaim(claimId, values) {
      const current = claims.get(claimId);
      if (!current) throw new Error("Claim not found");
      const updated = { ...current, ...values };
      claims.set(claimId, updated);
      return updated;
    },
    async createDenial(values) { return { id: id("denial"), ...values }; },
    async upsertWorkItem(values) { return { id: id("work"), ...values }; },
  };
  return { repo, claims, adjustments };
}

test("payment reversal is a single constrained database RPC with no direct anon allocation update", () => {
  assert.equal(existsSync(atomicReversalMigrationUrl), true);
  if (!existsSync(atomicReversalMigrationUrl)) return;
  const sql = readFileSync(atomicReversalMigrationUrl, "utf8");

  assert.match(sql, /create\s+or\s+replace\s+function\s+private\.reverse_demo_payment/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /settings\s*->>\s*'demo'/i);
  assert.match(sql, /insert\s+into\s+public\.payment_reversals/i);
  assert.match(sql, /update\s+public\.payment_allocations/i);
  assert.match(sql, /update\s+public\.payments/i);
  assert.match(sql, /update\s+public\.professional_claims/i);
  assert.match(sql, /revoke\s+update\s*\(\s*reversed_at\s*\)\s+on\s+table\s+public\.payment_allocations\s+from\s+anon/i);
  assert.match(sql, /revoke\s+insert\s+on\s+table\s+public\.payment_reversals\s+from\s+anon/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.reverse_demo_payment/i);
  assert.match(sql, /security\s+invoker/i);

  const reverseSection = paymentRepositorySource.split("export async function reversePayment")[1] ?? "";
  assert.match(reverseSection, /demoRpc/);
  assert.match(reverseSection, /reverse_demo_payment/);
  assert.doesNotMatch(reverseSection, /demoUpdateExact<DataRow>\("payment_allocations"/);
  assert.doesNotMatch(reverseSection, /demoInsert<DataRow>\("payment_reversals"/);
});

test("ERA adjudication can post a durable patient-responsibility balance", async () => {
  const state = makeEraRepo();
  const result = await postDemoEraWorkflow(state.repo, {
    claimId: "claim-1",
    paidAmountCents: 8000,
    adjustmentAmountCents: 2000,
    patientResponsibilityCents: 2000,
    traceNumber: "ERA-PATIENT-AR",
    carcCode: "45",
  });

  assert.equal(result.ok, true);
  assert.equal(state.adjustments.length, 1);
  assert.equal(state.adjustments[0].amount_cents, 2000);
  assert.equal(state.claims.get("claim-1")?.claim_status, "patient_responsibility");
  assert.equal(state.claims.get("claim-1")?.metadata?.patient_responsibility_cents, 2000);
});

test("patient responsibility cannot exceed the adjudicated remainder", async () => {
  const state = makeEraRepo();
  const result = await postDemoEraWorkflow(state.repo, {
    claimId: "claim-1",
    paidAmountCents: 8000,
    adjustmentAmountCents: 3000,
    patientResponsibilityCents: 2000,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "era_overage");
});

test("Phase 3 includes a connected patient A/R scenario and seed", () => {
  assert.equal(phase3BillingScenarios.some((scenario) => scenario.code === "patient_responsibility"), true);
  assert.match(patientArSeedSource, /P3-PATIENT-AR-001/);
  assert.match(patientArSeedSource, /'patient_responsibility'/);
  assert.match(patientArSeedSource, /"patient_responsibility_cents"\s*:\s*2000/);
  assert.match(patientArSeedSource, /insert\s+into\s+era_files/i);
  assert.match(patientArSeedSource, /insert\s+into\s+era_claims/i);
  assert.match(patientArSeedSource, /insert\s+into\s+era_matches/i);
  assert.match(patientArSeedSource, /insert\s+into\s+payment_allocations/i);
  assert.match(patientArSeedSource, /insert\s+into\s+adjustment_allocations/i);
});
