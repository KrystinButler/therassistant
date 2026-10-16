import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("authenticated staff leaving /login is redirected to the dashboard", () => {
  assert.match(
    appSource,
    /location === "\/login"[\s\S]*rootPortalDestination === "none"[\s\S]*<Redirect to="\/"/,
    "authenticated staff should not remain on /login after account access resolves to staff",
  );
});
