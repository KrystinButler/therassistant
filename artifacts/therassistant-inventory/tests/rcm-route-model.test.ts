import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");

test("App exposes canonical Rejections and Denials routes", () => {
  assert.match(appSource, /path="\/rejections"/);
  assert.match(appSource, /path="\/denials"/);
});

test("legacy duplicate RCM routes render Redirect instead of old workflow pages", () => {
  assert.match(appSource, /path="\/charges"[^\n]*<Redirect to="\/billing\/charges"/);
  assert.match(appSource, /path="\/claims\/submission"[^\n]*<Redirect to="\/billing\/charges"/);
  assert.match(appSource, /path="\/claims\/follow-up"[^\n]*<Redirect to="\/claims"/);
  assert.match(appSource, /path="\/ar-denials"[^\n]*<Redirect to="\/denials"/);
  assert.match(appSource, /path="\/work-center"[^\n]*<Redirect to="\/claims"/);
});

test("AppShell uses section navigation and no user-facing workspace label", () => {
  assert.match(shellSource, /navigation\/sections/);
  assert.match(shellSource, /aria-label="Primary navigation"/);
  assert.doesNotMatch(shellSource, /Operational Workspace/);
  assert.doesNotMatch(shellSource, /Workspace navigation/);
});
