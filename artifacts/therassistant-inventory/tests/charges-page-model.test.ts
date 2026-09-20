import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx", import.meta.url), "utf8");

test("Charges owns validation, batching, submission and claim outputs", () => {
  assert.match(source, /<h1>Charges<\/h1>/);
  assert.match(source, /validateClaim/);
  assert.match(source, /createBatch/);
  assert.match(source, /recordExternalSubmission/);
  assert.doesNotMatch(source, /Submit Electronically/);
  assert.match(source, /Download 837P/);
  assert.match(source, /Print CMS-1500/);
});

test("Charges no longer links to a separate claim submission workflow", () => {
  assert.doesNotMatch(source, /href="\/claims\/submission"/);
  assert.doesNotMatch(source, />Claim Submission</);
});
