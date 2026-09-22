import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("provider root route opens the connected workflow dashboard", () => {
  assert.match(appSource, /import \{ DashboardPage \} from "\.\/pages\/dashboard";/);
  assert.match(appSource, /<Route path="\/"><DashboardPage \/><\/Route>/);
  assert.doesNotMatch(appSource, /<Route path="\/">\s*<Redirect to="\/schedule"/);
});
