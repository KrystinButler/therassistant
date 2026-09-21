import test from "node:test";
import assert from "node:assert/strict";
import { allocatePaymentOldestDueFirst } from "../src/domains/crm/payment-plan";

test("allocates oldest due first and preserves overpayment remainder", () => {
  const result=allocatePaymentOldestDueFirst({paymentCents:25000,installments:[
    {id:"a",sequence:1,dueDate:"2026-10-01",amountDueCents:10000,amountPaidCents:0,status:"due"},
    {id:"b",sequence:2,dueDate:"2026-11-01",amountDueCents:10000,amountPaidCents:2000,status:"partial"},
    {id:"c",sequence:3,dueDate:"2026-12-01",amountDueCents:10000,amountPaidCents:10000,status:"paid"},
  ]});
  assert.deepEqual(result.allocations,[{installmentId:"a",amountCents:10000},{installmentId:"b",amountCents:8000}]);
  assert.equal(result.unallocatedCents,7000);
});
test("partial payment does not overfill installment", () => {
  const result=allocatePaymentOldestDueFirst({paymentCents:3000,installments:[{id:"a",sequence:1,dueDate:"2026-10-01",amountDueCents:10000,amountPaidCents:0,status:"due"}]});
  assert.deepEqual(result.allocations,[{installmentId:"a",amountCents:3000}]);
  assert.equal(result.unallocatedCents,0);
});
