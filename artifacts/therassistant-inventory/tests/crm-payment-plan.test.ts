import test from "node:test";
import assert from "node:assert/strict";
import { buildInstallmentSchedule } from "../src/domains/crm/payment-plan";

test("creates a smaller final installment without overbilling", () => {
  assert.deepEqual(buildInstallmentSchedule({ remainingBalanceCents: 110000, installmentCents: 30000, frequency: "monthly", firstDueDate: "2026-10-01" }).map((x) => x.amountCents), [30000,30000,30000,20000]);
});
test("weekly and biweekly schedules advance correctly", () => {
  assert.deepEqual(buildInstallmentSchedule({ remainingBalanceCents: 20000, installmentCents: 10000, frequency: "weekly", firstDueDate: "2026-10-01" }).map((x) => x.dueDate), ["2026-10-01","2026-10-08"]);
  assert.deepEqual(buildInstallmentSchedule({ remainingBalanceCents: 20000, installmentCents: 10000, frequency: "biweekly", firstDueDate: "2026-10-01" }).map((x) => x.dueDate), ["2026-10-01","2026-10-15"]);
});
test("monthly schedule clamps month-end dates", () => {
  assert.deepEqual(buildInstallmentSchedule({ remainingBalanceCents: 30000, installmentCents: 10000, frequency: "monthly", firstDueDate: "2027-01-31" }).map((x) => x.dueDate), ["2027-01-31","2027-02-28","2027-03-31"]);
});
test("rejects invalid balances and installments", () => {
  assert.throws(() => buildInstallmentSchedule({ remainingBalanceCents: 0, installmentCents: 100, frequency: "monthly", firstDueDate: "2026-10-01" }));
  assert.throws(() => buildInstallmentSchedule({ remainingBalanceCents: 100, installmentCents: 0, frequency: "monthly", firstDueDate: "2026-10-01" }));
});
