import test from "node:test";
import assert from "node:assert/strict";
import { summarizePostedPayments } from "../src/domains/payments/posted-payment-summary.ts";

test("posted payment total excludes reversed and voided payments", () => {
  const result = summarizePostedPayments([
    { payment_status: "posted", posted_at: "2026-10-01T00:00:00Z", amount_cents: 12_500 },
    { payment_status: "partially_applied", posted_at: "2026-10-02T00:00:00Z", amount_cents: 4_000 },
    { payment_status: "reversed", posted_at: "2026-10-03T00:00:00Z", amount_cents: 50_000 },
    { payment_status: "voided", posted_at: "2026-10-04T00:00:00Z", amount_cents: 7_000 },
    { payment_status: "posted", posted_at: null, amount_cents: 5_000 },
    { payment_status: "unapplied", posted_at: null, amount_cents: 3_000 },
  ]);
  assert.deepEqual(result, { totalCents: 16_500, count: 2 });
});

test("reversed-only payment activity has no posted cash", () => {
  assert.deepEqual(summarizePostedPayments([
    { payment_status: "reversed", posted_at: "2026-10-03T00:00:00Z", amount_cents: 50_000 },
  ]), { totalCents: 0, count: 0 });
});
