import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const repository = readFileSync(
  new URL("../src/domains/payments/repository.ts", import.meta.url),
  "utf8",
);
const allocation = readFileSync(
  new URL("../src/domains/payments/payment-allocation.ts", import.meta.url),
  "utf8",
);

test("manual payment and reversal use tenant-scoped production RPCs", () => {
  assert.match(repository, /post_manual_payment/);
  assert.match(repository, /reverse_payment/);
  assert.match(repository, /p_tenant_id/);
  assert.doesNotMatch(repository, /post_demo_manual_payment/);
  assert.doesNotMatch(repository, /reverse_demo_payment/);
});

test("existing payment allocation is one atomic database operation", () => {
  assert.match(allocation, /allocate_payment/);
  assert.match(allocation, /tenantRpc/);
  assert.doesNotMatch(allocation, /tenantInsert/);
  assert.doesNotMatch(allocation, /tenantUpdate/);
});
