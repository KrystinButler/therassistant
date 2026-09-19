import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const retiredPages = [
  "../src/domains/claims/ClaimSubmissionPage.tsx",
  "../src/domains/claims/ClaimsWorkspacePage.tsx",
  "../src/domains/ar/ArWorkspacePage.tsx",
];

test("retired duplicate RCM pages are removed from the application source", () => {
  for (const relativePath of retiredPages) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, relativePath);
  }
});
