import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx", import.meta.url), "utf8");

test("Charge Capture and Billing Routing owns funding queues, claim validation, batching, submission and claim outputs", () => {
  assert.match(source, /<h1>Charge Capture & Billing Routing<\/h1>/);
  assert.match(source, /Ready for Billing/);
  assert.match(source, /Program Billing/);
  assert.match(source, /Private Pay/);
  assert.match(source, /Validation Hold/);
  assert.match(source, /837P Batches/);
  assert.match(source, /validateClaim/);
  assert.match(source, /createBatch/);
  assert.match(source, /recordExternalSubmission/);
  assert.doesNotMatch(source, /Submit Electronically/);
  assert.match(source, /Download 837P/);
  assert.match(source, /Print CMS-1500/);
});

test("charge workflow remains one connected workspace instead of a separate claim-submission route", () => {
  assert.doesNotMatch(source, /href="\/claims\/submission"/);
  assert.match(source, /GET PAID · STAGES 04–05/);
});

test("Insurance Claims explains preparation, validation, batching and clearly distinguishes submission", () => {
  assert.match(source, /Insurance Claims/);
  assert.match(source, /Prepare Insurance Claims/);
  assert.match(source, /Nothing is sent to an insurer from this section/);
  assert.match(source, /Group by payer/);
  assert.match(source, /No insurance charges or claims require preparation/);
});
