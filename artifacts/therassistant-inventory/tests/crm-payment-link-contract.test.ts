import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../../supabase/functions/payment-desk-api/index.ts", import.meta.url),
  "utf8",
);
const allocationMigration = readFileSync(
  new URL("../../../supabase/migrations/20260921083200_crm_atomic_payment_allocation.sql", import.meta.url),
  "utf8",
);

test("preserves payment idempotency and links completed payments to CRM", () => {
  assert.match(source, /idempotency_key/);
  assert.match(source, /crm_account_id/);
  assert.match(source, /allocateCrmPayment/);
  assert.match(source, /crm_allocate_production_payment_atomic/);
  assert.match(allocationMigration, /insert into public\.crm_payment_allocations/i);
});

test("creates Square-hosted payment links server-side", () => {
  assert.match(source, /create-payment-link/);
  assert.match(source, /\/v2\/online-checkout\/payment-links/);
  assert.match(source, /SQUARE_ACCESS_TOKEN/);
  assert.match(source, /quick_pay/);
});

test("refreshes a link through order tender payment id", () => {
  assert.match(source, /refresh-payment-link/);
  assert.match(source, /\/v2\/orders\//);
  assert.match(source, /tenders/);
  assert.match(source, /payment_id/);
  assert.match(source, /\/v2\/payments\//);
});

test("does not add PAN or CVV persistence", () => {
  assert.doesNotMatch(source, /card_number|security_code|\bcvv\b|\bpan\b/i);
});

test("sandbox payments never allocate to real CRM installments", () => {
  assert.match(source, /squareEnvironment:\s*["']sandbox["']\s*\|\s*["']production["']/);
  assert.match(source, /squareEnvironment !== ["']production["']\) return/);
  assert.match(source, /idempotencyKey\.length > 45/);
  assert.match(allocationMigration, /square_environment='production'/i);
});

test("production payment allocation delegates to one atomic database RPC", () => {
  assert.match(source, /crm_allocate_production_payment_atomic/);
  assert.doesNotMatch(source, /from\(["']crm_payment_allocations["']\)\s*\n?\s*\.insert/);
  assert.match(allocationMigration, /for update/i);
  assert.match(allocationMigration, /unallocatedCents/i);
});
