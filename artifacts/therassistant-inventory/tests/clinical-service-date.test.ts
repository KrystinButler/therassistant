import test from "node:test";
import assert from "node:assert/strict";
import { clinicalServiceDate } from "../src/domains/clinical/service-date.ts";

test("evening Denver visits do not become tomorrow's clinical notes", () => {
  assert.equal(clinicalServiceDate("2026-10-06T04:36:00Z", "America/Denver"), "2026-10-05");
  assert.equal(clinicalServiceDate("2026-10-06T05:59:59Z", "America/Denver"), "2026-10-05");
  assert.equal(clinicalServiceDate("2026-10-06T06:00:00Z", "America/Denver"), "2026-10-06");
});
test("service dates respect configured timezone and winter offset", () => {
  assert.equal(clinicalServiceDate("2026-01-06T06:30:00Z", "America/Denver"), "2026-01-05");
  assert.equal(clinicalServiceDate("2026-10-06T04:36:00Z", "UTC"), "2026-10-06");
  assert.equal(clinicalServiceDate("2026-10-06T04:36:00Z", "Asia/Tokyo"), "2026-10-06");
});
test("invalid date or timezone fails instead of silently choosing another date", () => {
  assert.throws(() => clinicalServiceDate("invalid", "America/Denver"));
  assert.throws(() => clinicalServiceDate("2026-10-06T04:36:00Z", "invalid"));
});
