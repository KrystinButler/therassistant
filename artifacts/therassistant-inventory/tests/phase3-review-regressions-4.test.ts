import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as paymentOperations from "../src/domains/payments/operations";
import * as claimWorkqueues from "../src/domains/claims/workqueues";

const rejectionsPageSource = readFileSync(
  new URL("../src/domains/claims/RejectionsPage.tsx", import.meta.url),
  "utf8",
);
const claimsWorkspaceRepositorySource = readFileSync(
  new URL("../src/domains/claims/workspace-repository.ts", import.meta.url),
  "utf8",
);
const phase3SeedSource = readFileSync(
  new URL("../../../supabase/seed/2026-09-13-phase3-demo.sql", import.meta.url),
  "utf8",
);

test("financial synchronization preserves operational and responsibility claim states", () => {
  const deriveSynchronizedClaimStatus = (
    paymentOperations as Record<string, unknown>
  ).deriveSynchronizedClaimStatus as
    | ((currentStatus: unknown, financialStatus: "accepted" | "partially_paid" | "paid") => string)
    | undefined;

  assert.equal(typeof deriveSynchronizedClaimStatus, "function");
  if (!deriveSynchronizedClaimStatus) return;

  assert.equal(deriveSynchronizedClaimStatus("rejected", "partially_paid"), "rejected");
  assert.equal(deriveSynchronizedClaimStatus("denied", "partially_paid"), "denied");
  assert.equal(deriveSynchronizedClaimStatus("appealed", "paid"), "appealed");
  assert.equal(deriveSynchronizedClaimStatus("patient_responsibility", "partially_paid"), "patient_responsibility");
  assert.equal(deriveSynchronizedClaimStatus("accepted", "partially_paid"), "partially_paid");
  assert.equal(deriveSynchronizedClaimStatus("partially_paid", "paid"), "paid");
  assert.equal(deriveSynchronizedClaimStatus("paid", "partially_paid"), "partially_paid");
});

test("latest rejected response makes submitted or batched claims retryable", () => {
  const isRetryableRejection = (
    claimWorkqueues as Record<string, unknown>
  ).isRetryableRejection as
    | ((claimStatus: unknown, latestResponseStatus: unknown) => boolean)
    | undefined;

  assert.equal(typeof isRetryableRejection, "function");
  if (!isRetryableRejection) return;

  assert.equal(isRetryableRejection("rejected", "accepted"), true);
  assert.equal(isRetryableRejection("submitted", "rejected"), true);
  assert.equal(isRetryableRejection("batched", "rejected"), true);
  assert.equal(isRetryableRejection("submitted", "accepted"), false);
  assert.equal(isRetryableRejection("accepted", "rejected"), false);
  assert.match(rejectionsPageSource, /row\.clearinghouseStatus === "rejected"/);
  assert.doesNotMatch(
    rejectionsPageSource,
    /\.filter\(\(row\) => row\.claim_status === "rejected"\)/,
  );
  assert.match(claimsWorkspaceRepositorySource, /submission_responses/);
  assert.match(claimsWorkspaceRepositorySource, /isRetryableRejection/);
});

test("claim follow-up deduplication is scoped to the intended workqueue type", () => {
  const followUpSection = claimsWorkspaceRepositorySource.split("export async function createClaimFollowUps")[1] ?? "";
  assert.match(followUpSection, /workqueue_type:\s*`eq\.\$\{type\}`/);
  assert.match(followUpSection, /source_object_id:\s*`eq\.\$\{claimId\}`/);
});

test("Phase 3 recoupment seed reopens the claim financial state", () => {
  assert.match(
    phase3SeedSource,
    /62000000-0000-4000-8000-000000000004[\s\S]{0,500}'partially_paid'[\s\S]{0,500}'P3-RECOUP-001'/,
  );
});

test("Phase 3 credentialing write-off seed closes the claim financial state", () => {
  assert.match(
    phase3SeedSource,
    /62000000-0000-4000-8000-000000000006[\s\S]{0,500}'paid'[\s\S]{0,500}'P3-CRED-WO-001'/,
  );
});
