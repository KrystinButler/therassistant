import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");

test("App exposes canonical Rejections and Denials routes", () => {
  assert.match(appSource, /path="\/rejections"/);
  assert.match(appSource, /path="\/denials"/);
});

test("legacy duplicate RCM routes redirect while Work Center is operational", () => {
  assert.match(appSource, /path="\/charges"[^\n]*<Redirect to="\/billing\/charges"/);
  assert.match(appSource, /path="\/claims\/submission"[^\n]*<Redirect to="\/billing\/charges"/);
  assert.match(appSource, /path="\/claims\/follow-up"[^\n]*<Redirect to="\/claims"/);
  assert.match(appSource, /path="\/ar-denials"[^\n]*<Redirect to="\/denials"/);
  assert.match(appSource, /import \{ WorkCenterPage \} from "\.\/pages\/work-center"/);
  assert.match(appSource, /path="\/work-center"[^\n]*<WorkCenterPage/);
});

test("AppShell uses the approved direct navigation and retains working module destinations", () => {
  assert.match(shellSource, /aria-label="Primary navigation"/);
  for (const path of ["/schedule", "/clients", "/clinical", "/billing/charges", "/claims", "/payments", "/reports", "/payers-contracts", "/providers", "/credentialing", "/work-center"]) {
    assert.ok(shellSource.includes(path), path);
  }
  assert.doesNotMatch(shellSource, /navigation\/sections/);
  assert.doesNotMatch(shellSource, /Operational Workspace|Workspace navigation/);
  assert.doesNotMatch(shellSource, /href="\/authorizations"|href="\/mailroom"/);
});
