import test from "node:test";
import assert from "node:assert/strict";

import { phase1DemoScenarios } from "../src/domains/demo/scenarios.ts";

test("Phase 1 demo stories match the connected synthetic scenarios", () => {
  assert.equal(phase1DemoScenarios.length, 7);
  assert.deepEqual(
    phase1DemoScenarios.map((story) => story.title),
    [
      "Clean Revenue Cycle",
      "Inactive Eligibility",
      "Missing Authorization",
      "Credentialing Block",
      "Missing Documentation",
      "Clearinghouse Rejection",
      "Payer Denial",
    ],
  );
  assert.equal(phase1DemoScenarios[0].href, "/clients/ff648f71-9c94-433c-9aab-f80b039a80fd");
  assert.equal(phase1DemoScenarios[5].href, "/claims/61000000-0000-4000-8000-000000000002");
  assert.equal(phase1DemoScenarios[6].href, "/claims/61000000-0000-4000-8000-000000000003");
});
