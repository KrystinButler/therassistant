import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { import835Workflow, type EraImportRepository } from "../src/domains/payments/workflow.ts";
import { phase3BillingScenarios } from "../src/domains/demo/phase3-scenarios.ts";

const paymentRepositorySource = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const atomicReversalMigrationUrl = new URL(
  "../../../supabase/migrations/20260914005021_phase3_atomic_demo_payment_reversal.sql",
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
  const payments: Row[] = [];
  const eraFiles: Row[] = [];
  const eraClaims: Row[] = [];
  const claimLines = new Map<string, Row[]>([
    ["claim-1", [{ id: "line-1", claim_id: "claim-1", service_date: "2026-09-01", cpt_code: "90837", charge_amount_cents: 12000 }]],
  ]);
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;
  const repo: EraImportRepository = {
    async getClaim(claimId) { return claims.get(claimId) ?? null; },
    async findClaimsByPatientControlNumber(control) { return [...claims.values()].filter((row) => row.patient_control_number === control); },
    async getClaimLines(claimId) { return claimLines.get(claimId) ?? []; },
    async getEraFileByTrace(trace) { return eraFiles.find((row) => row.check_or_trace_number === trace) ?? null; },
    async createPayment(values) { const row = { id: id("payment"), ...values }; payments.push(row); return row; },
    async updatePayment(paymentId, values) { const row = payments.find((item) => item.id === paymentId); if (!row) throw new Error("Payment not found"); Object.assign(row, values); return row; },
    async createPaymentAllocation(values) { return { id: id("allocation"), ...values }; },
    async createAdjustment(values) { const row = { id: id("adjustment"), ...values }; adjustments.push(row); return row; },
    async createAdjustmentAllocation(values) { return { id: id("adjustment-allocation"), ...values }; },
    async createEraFile(values) { const row = { id: id("era-file"), ...values }; eraFiles.push(row); return row; },
    async createEraClaim(values) { const row = { id: id("era-claim"), ...values }; eraClaims.push(row); return row; },
    async createEraMatch(values) { return { id: id("era-match"), ...values }; },
    async createEraServiceLine(values) { return { id: id("era-line"), ...values }; },
    async updateEraFile(eraFileId, values) { const row = eraFiles.find((item) => item.id === eraFileId); if (!row) throw new Error("ERA file not found"); Object.assign(row, values); return row; },
    async updateEraClaim(eraClaimId, values) { const row = eraClaims.find((item) => item.id === eraClaimId); if (!row) throw new Error("ERA claim not found"); Object.assign(row, values); return row; },
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
  return { repo, claims, adjustments, payments, eraFiles, eraClaims };
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
  assert.match(reverseSection, /tenantRpc/);
  assert.match(reverseSection, /reverse_demo_payment/);
  assert.doesNotMatch(reverseSection, /tenantUpdate<DataRow>\("payment_allocations"/);
  assert.doesNotMatch(reverseSection, /tenantInsert<DataRow>\("payment_reversals"/);
});

test("real 835 adjudication can post a durable patient-responsibility balance", async () => {
  const state = makeEraRepo();
  const rawText = [
    "ST*835*0001",
    "BPR*I*80.00*C*ACH*CCP************20260920",
    "TRN*1*ERA-PATIENT-AR",
    "CLP*PATIENT-AR-1*1*120.00*80.00*20.00**PAYER-AR-1",
    "SVC*HC:90837*120.00*80.00",
    "DTM*472*20260901",
    "CAS*CO*45*20.00",
    "CAS*PR*1*20.00",
    "SE*9*0001",
  ].join("~") + "~";

  const result = await import835Workflow(state.repo, { rawText, fileName: "patient-ar.835" });

  assert.equal(result.ok, true);
  assert.equal(state.adjustments.length, 1);
  assert.equal(state.adjustments[0].amount_cents, 2000);
  assert.equal(state.claims.get("claim-1")?.claim_status, "patient_responsibility");
  assert.equal(state.claims.get("claim-1")?.metadata?.patient_responsibility_cents, 2000);
});

test("real 835 import refuses to auto-post an adjudication that does not reconcile", async () => {
  const state = makeEraRepo();
  const rawText = [
    "ST*835*0002",
    "BPR*I*80.00*C*ACH*CCP************20260920",
    "TRN*1*ERA-OVERAGE",
    "CLP*PATIENT-AR-1*1*120.00*80.00*20.00**PAYER-AR-2",
    "SVC*HC:90837*120.00*80.00",
    "DTM*472*20260901",
    "CAS*CO*45*30.00",
    "CAS*PR*1*20.00",
    "SE*9*0002",
  ].join("~") + "~";

  const result = await import835Workflow(state.repo, { rawText, fileName: "overage.835" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.postedCount, 0);
  assert.ok(result.value.exceptionCount > 0);
  assert.equal(state.claims.get("claim-1")?.claim_status, "accepted");
  assert.equal(state.adjustments.length, 0);
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
