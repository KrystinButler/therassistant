import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../src/domains/claims/workflow.ts", import.meta.url), "utf8");
const rejectionsSource = readFileSync(new URL("../src/domains/claims/RejectionsPage.tsx", import.meta.url), "utf8");
const correctionDrawerSource = readFileSync(new URL("../src/domains/claims/rejection-work-drawer.tsx", import.meta.url), "utf8");

test("App routes Rejections to the dedicated page", () => {
  assert.match(appSource, /import \{ RejectionsPage \}/);
  assert.match(appSource, /path="\/rejections"[^\n]*<RejectionsPage/);
});

test("claim workflow no longer describes rejection work as Work Center routing", () => {
  assert.doesNotMatch(workflowSource, /Work Center/);
});

test("Rejections honors canonical ownership so active denials cannot overlap", () => {
  assert.match(rejectionsSource, /getClaimsQueueData/);
  assert.match(rejectionsSource, /getOperationalHome/);
  assert.match(rejectionsSource, /hasActiveDenial/);
  assert.match(rejectionsSource, /=== "rejections"/);
});


test("validation holds exclude stale clearinghouse rejections", () => {
  assert.match(rejectionsSource, /row\.workqueue_type === \(validationHold \? "claim_validation" : "claim_rejection"\)/);
  assert.match(rejectionsSource, /const latestRejectedResponse = validationHold \? undefined/);
  assert.match(correctionDrawerSource, /const rejectedResponses = isValidationHold \? \[\]/);
  assert.match(correctionDrawerSource, /isValidationHold \? "Claim validation hold" : "Clearinghouse rejection"/);
});
