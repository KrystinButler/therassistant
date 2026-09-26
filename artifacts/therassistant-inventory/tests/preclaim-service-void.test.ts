import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql=readFileSync(new URL("../../../supabase/migrations/20260926010000_void_unclaimed_service_lines.sql",import.meta.url),"utf8");
const clinical=readFileSync(new URL("../src/domains/clinical/repository.ts",import.meta.url),"utf8");
test("pre-claim void operation enforces tenant ownership and claim/charge guards, preserves charge audit",()=>{
  assert.match(sql,/private\.has_tenant_write_access\(v_tenant_id\)/);
  assert.match(sql,/professional_claims/);
  assert.match(sql,/charge_status='voided'/);
  assert.match(sql,/audit_logs/);
  assert.match(sql,/revoke all on function private\.void_unclaimed_service_line_impl/);
  assert.match(sql,/grant execute on function public\.void_unclaimed_service_line/);
  assert.match(clinical,/voidPreclaimServiceLine/);
});
