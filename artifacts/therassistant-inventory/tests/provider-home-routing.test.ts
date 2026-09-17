import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("provider root route opens Schedule instead of an Overview dashboard", () => {
  assert.match(appSource, /<Route path="\/">\s*<Redirect to="\/schedule"\s*\/?>\s*<\/Route>/);
  assert.doesNotMatch(appSource, /DashboardPage/);
});
