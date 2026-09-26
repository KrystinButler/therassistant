import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../../../supabase/functions/provision-test-patient/index.ts",import.meta.url),"utf8");
test("test patient provisioning authenticates, checks active admin in tenant, and never impersonates a real patient",()=>{
  assert.match(source,/auth\.getUser\(token\)/);
  assert.match(source,/tenant_users/);
  assert.match(source,/tenant_user_roles/);
  assert.match(source,/practice_admin/);
  assert.match(source,/metadata: \{ synthetic: true, portal_test: true/);
  assert.match(source,/example\.test/);
  assert.match(source,/Cache-Control/);
  assert.match(source,/audit_logs/);
});
