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

test("portal messages are stored behind RLS with no direct authenticated table access", () => {
  const sql = migration("secure_patient_portal_messaging");
  assert.match(sql, /alter table public\.portal_message_threads enable row level security/i);
  assert.match(sql, /alter table public\.portal_messages enable row level security/i);
  assert.match(sql, /revoke all on table public\.portal_message_threads from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.portal_messages from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function private\.portal_message_threads_json\(uuid, uuid\) from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function private\.portal_message_threads_json/i);
});

test("patient message RPCs derive the patient from active portal identity", () => {
  const sql = migration("secure_patient_portal_messaging");
  const marker = "create or replace function private.portal_send_message_impl(";
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, "missing patient send-message implementation");
  const end = sql.indexOf("$;", start);
  assert.notEqual(end, -1, "unterminated patient send-message implementation");
  const sendImpl = sql.slice(start, end + 3);

  assert.match(sql, /private\.get_my_portal_messages_impl/i);
  assert.match(sendImpl, /client_portal_access/i);
  assert.match(sendImpl, /cpa\.user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sendImpl, /cpa\.status\s*=\s*'active'/i);
  assert.doesNotMatch(sendImpl, /p_client_id\s+uuid/i);
});

test("patient messages create client work and cannot write staff messages", () => {
  const sql = migration("secure_patient_portal_messaging");
  assert.match(sql, /'patient'[\s\S]*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /'correspondence'::public\.workqueue_type_enum/i);
  assert.match(sql, /'client'::public\.workqueue_source_object_type_enum/i);
  assert.match(sql, /Patient Chart Engagement tab/i);
  assert.match(sql, /This conversation is closed\. Start a new message instead\./i);
});

test("staff messaging RPCs require tenant access and preserve immutable message rows", () => {
  const sql = migration("secure_patient_portal_messaging");
  assert.match(sql, /private\.has_tenant_read_access\(p_tenant_id\)/i);
  assert.match(sql, /private\.has_tenant_write_access\(p_tenant_id\)/i);
  assert.match(sql, /reply_client_portal_message_impl/i);
  assert.match(sql, /close_client_portal_message_thread_impl/i);
  assert.match(sql, /'staff'[\s\S]*\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /update\s+public\.portal_messages/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.portal_messages/i);
});

test("patient and staff surfaces use the same secure conversation thread", () => {
  const patient = readFileSync(new URL("../src/domains/portal/PatientMessagesPanel.tsx", import.meta.url), "utf8");
  const staff = readFileSync(new URL("../src/domains/portal/StaffPortalMessagesPanel.tsx", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/domains/portal/messages-repository.ts", import.meta.url), "utf8");
  const chart = readFileSync(new URL("../src/domains/patients/PatientChartPage.tsx", import.meta.url), "utf8");
  assert.match(patient, /Secure Messages/);
  assert.match(patient, /not monitored for emergencies/i);
  assert.match(staff, /Patient Portal Messages/);
  assert.match(staff, /Reply to Patient/);
  assert.match(repository, /get_my_portal_messages/);
  assert.match(repository, /portal_send_message/);
  assert.match(repository, /get_client_portal_messages/);
  assert.match(repository, /reply_client_portal_message/);
  assert.match(chart, /StaffPortalMessagesPanel/);
});
