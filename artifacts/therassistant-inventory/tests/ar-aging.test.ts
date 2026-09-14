import test from "node:test";
import assert from "node:assert/strict";

import { agingBucket, calculateOpenBalance } from "../src/domains/ar/aging";

test("aging bucket boundaries are stable", () => {
  const asOf = "2026-09-13";
  assert.equal(agingBucket("2026-08-14", asOf), "0-30");
  assert.equal(agingBucket("2026-08-13", asOf), "31-60");
  assert.equal(agingBucket("2026-07-15", asOf), "31-60");
  assert.equal(agingBucket("2026-07-14", asOf), "61-90");
  assert.equal(agingBucket("2026-06-15", asOf), "61-90");
  assert.equal(agingBucket("2026-06-14", asOf), "91-120");
  assert.equal(agingBucket("2026-05-16", asOf), "91-120");
  assert.equal(agingBucket("2026-05-15", asOf), "120+");
});

test("open balance subtracts posted payments and adjustments without going negative", () => {
  assert.equal(calculateOpenBalance(12000, 4000, 3000), 5000);
  assert.equal(calculateOpenBalance(12000, 13000, 1000), 0);
});
