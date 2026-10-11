import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("patient portal shared navigation exposes logout on desktop and mobile using the real auth flow", () => {
  const navigation = read("../src/domains/portal/PatientPortalNavigation.tsx");
  assert.match(navigation, /useAuth/);
  assert.match(navigation, /await signOut\(\)/);
  assert.match(navigation, /PORTAL_LOGIN/);
  assert.match(navigation, /Log Out/);
  assert.match(navigation, /ppn-logout/);
  assert.match(navigation, /PatientPortalNavigation/);
  assert.match(navigation, /PatientPortalMobileNavigation/);
});
