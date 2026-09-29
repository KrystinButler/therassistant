import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function migration(name: string) {
  const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${name}.sql`));
  assert.ok(file, `missing migration: ${name}`);
  return readFileSync(join(dir, file), "utf8");
}

test("patient change request RPC derives tenant and patient from active portal access", () => {
  const sql = migration("patient_portal_change_requests");
  assert.match(sql, /private\.portal_submit_change_request_impl/i);
  assert.match(sql, /cpa\.user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /cpa\.status\s*=\s*'active'/i);
  assert.doesNotMatch(sql, /p_client_id\s+uuid|p_tenant_id\s+uuid/i);
  assert.match(sql, /v_request_type not in \('demographics', 'insurance'\)/i);
  assert.match(sql, /length\(v_details\) > 2000/i);
});

test("patient change request creates actionable mailroom and workqueue records", () => {
  const sql = migration("patient_portal_change_requests");
  assert.match(sql, /insert into public\.mailroom_items/i);
  assert.match(sql, /'client_correspondence'/i);
  assert.match(sql, /'action_required'/i);
  assert.match(sql, /insert into public\.workqueue_items/i);
  assert.match(sql, /'correspondence'::public\.workqueue_type_enum/i);
  assert.match(sql, /'mailroom_item'::public\.workqueue_source_object_type_enum/i);
  assert.match(sql, /'open'::public\.workqueue_status_enum/i);
  assert.match(sql, /insert into public\.status_history/i);
});

test("public patient change request wrapper is invoker-only and not anonymous", () => {
  const sql = migration("patient_portal_change_requests");
  assert.match(sql, /create or replace function public\.portal_submit_change_request/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.portal_submit_change_request\(text, text\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.portal_submit_change_request\(text, text\) to authenticated/i);
});

test("patient portal exposes demographic and insurance change request actions", () => {
  const page = readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/domains/portal/repository.ts", import.meta.url), "utf8");
  assert.match(page, /Report a Change/);
  assert.match(page, /Report Insurance Change/);
  assert.match(page, /Send Update Request/);
  assert.match(page, /practice work queue/);
  assert.match(repository, /portal_submit_change_request/);
  assert.match(repository, /2,000 characters or fewer/);
});
