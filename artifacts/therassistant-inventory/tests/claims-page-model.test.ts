import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("App routes Claims to the dedicated payer queue page", () => {
  assert.match(appSource, /import \{ ClaimsPage \}/);
  assert.match(appSource, /path="\/claims"[^\n]*<ClaimsPage/);
});

test("Claims page exposes only the approved follow-up tabs", () => {
  const source = readFileSync(new URL("../src/domains/claims/ClaimsPage.tsx", import.meta.url), "utf8");
  for (const label of ["No Response", "Deferred", "0-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "120+ Days"]) {
    assert.match(source, new RegExp(label.replace(/[+]/g, "\\+")));
  }
  assert.match(source, /getClaimsTab/);
  assert.match(source, /getOperationalHome/);
  for (const removed of ["Validation", "Submission", "Rejections", "Denials", "Appeals", "Workqueues"]) {
    assert.doesNotMatch(source, new RegExp(`>${removed}<`));
  }
});
