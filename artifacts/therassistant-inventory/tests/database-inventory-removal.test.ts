import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const administrationSource = readFileSync(
  new URL("../src/pages/administration.tsx", import.meta.url),
  "utf8",
);

test("database inventory is not exposed as an application feature", () => {
  assert.doesNotMatch(appSource, /InventoryApp/);
  assert.doesNotMatch(appSource, /administration\/database-inventory/);
  assert.doesNotMatch(administrationSource, /Database Inventory/);
  assert.doesNotMatch(administrationSource, /administration\/database-inventory/);
});
