import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../src/domains/claims/workflow.ts", import.meta.url), "utf8");

test("App routes Rejections to the dedicated page", () => {
  assert.match(appSource, /import \{ RejectionsPage \}/);
  assert.match(appSource, /path="\/rejections"[^\n]*<RejectionsPage/);
});

test("claim workflow no longer describes rejection work as Work Center routing", () => {
  assert.doesNotMatch(workflowSource, /Work Center/);
});
