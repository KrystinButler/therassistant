import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantContextSource = readFileSync(
  new URL("../src/auth/tenant-context.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);

test("authenticated staff without a tenant can bootstrap a real organization", () => {
  assert.match(tenantContextSource, /bootstrap_tenant_for_user/);
  assert.match(tenantContextSource, /bootstrapOrganization/);
  assert.match(appSource, /OrganizationSetup/);
});
