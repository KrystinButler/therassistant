import test from "node:test";
import assert from "node:assert/strict";

import {
  applicationAgingBucket,
  buildApplicationAgingSummary,
  buildExpirationSummary,
  buildParticipationSummary,
  buildRosterSummary,
  csvText,
} from "../src/domains/credentialing/reports";

test("application aging buckets use credentialing operational ranges", () => {
  assert.equal(applicationAgingBucket(0), "0-30");
  assert.equal(applicationAgingBucket(30), "0-30");
  assert.equal(applicationAgingBucket(31), "31-60");
  assert.equal(applicationAgingBucket(60), "31-60");
  assert.equal(applicationAgingBucket(61), "61-90");
  assert.equal(applicationAgingBucket(91), "91-120");
  assert.equal(applicationAgingBucket(121), "120+");
});

test("credentialing report summaries are derived from existing operational rows", () => {
  assert.deepEqual(
    buildApplicationAgingSummary([
      { application_age_days: 12, application_status: "submitted" },
      { application_age_days: 47, application_status: "payer_review" },
      { application_age_days: 121, application_status: "additional_information_requested" },
      { application_age_days: 9, application_status: "complete" },
    ]),
    [
      { label: "0-30", count: 1 },
      { label: "31-60", count: 1 },
      { label: "61-90", count: 0 },
      { label: "91-120", count: 0 },
      { label: "120+", count: 1 },
    ],
  );

  assert.deepEqual(
    buildParticipationSummary([
      { participation_status: "participating" },
      { participation_status: "participating" },
      { participation_status: "pending" },
      { participation_status: "non_participating" },
    ]),
    [
      { label: "participating", count: 2 },
      { label: "pending", count: 1 },
      { label: "non participating", count: 1 },
    ],
  );

  assert.deepEqual(
    buildRosterSummary([
      { status: "ready" },
      { status: "submitted" },
      { status: "rejected" },
      { status: "confirmed" },
    ]),
    [
      { label: "ready", count: 1 },
      { label: "submitted", count: 1 },
      { label: "rejected", count: 1 },
      { label: "confirmed", count: 1 },
    ],
  );

  const expirationRows = buildExpirationSummary([
    { due_date: "2026-09-17" },
    { due_date: "2026-09-30" },
    { due_date: "2026-11-01" },
    { due_date: "2027-01-01" },
  ], new Date("2026-09-18T12:00:00Z"));

  assert.equal(expirationRows.find((row) => row.label === "Overdue")?.count, 1);
  assert.equal(expirationRows.find((row) => row.label === "Due 30 Days")?.count, 1);
  assert.equal(expirationRows.find((row) => row.label === "Due 60 Days")?.count, 1);
});

test("CSV export escapes commas, quotes, and newlines", () => {
  assert.equal(
    csvText(
      ["Provider", "Notes"],
      [["Doe, Jane", 'Called "payer"\nconfirmed']],
    ),
    'Provider,Notes\r\n"Doe, Jane","Called ""payer""\nconfirmed"',
  );
});
