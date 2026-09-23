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

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

test("portal revocation is reversible without creating a second patient identity", () => {
  const sql = migration("complete_patient_engagement_connected_operations");
  assert.match(sql, /private\.restore_client_portal_access_impl/i);
  assert.match(sql, /where client_id = p_client_id[\s\S]+status = 'revoked'/i);
  assert.match(sql, /set status = 'active'[\s\S]+revoked_at = null/i);
  assert.match(sql, /patient_portal_access_restored/i);

  const staff = source("../src/domains/portal/staff-portal-access.ts");
  const panel = source("../src/domains/portal/PortalAccessPanel.tsx");
  assert.match(staff, /restoreClientPortalAccess/);
  assert.match(staff, /restore_client_portal_access/);
  assert.match(panel, /Restore Portal Access/);
  assert.doesNotMatch(panel, /Automatic relinking is not available/i);
});

test("document source events create deduplicated mailroom work and immutable history", () => {
  const sql = migration("complete_patient_engagement_connected_operations");
  assert.match(sql, /create table if not exists public\.document_history/i);
  assert.match(sql, /trg_capture_document_history/i);
  assert.match(sql, /to_jsonb\(new\)/i);
  assert.match(sql, /mailroom_items_source_event_uq/i);
  assert.match(sql, /trg_route_document_to_mailroom/i);
  assert.match(sql, /insert into public\.system_events/i);
  assert.match(sql, /insert into public\.notifications/i);
  assert.match(sql, /event_key.*document:/is);
  assert.match(sql, /storage_path like '%\/mailroom\/%'/i);
});

test("migration cutover supports self-pay, idempotency, retry, reconciliation, historical transactions, and rollback", () => {
  const sql = migration("complete_patient_engagement_connected_operations");
  for (const marker of [
    "source_file_hash",
    "mapping_profile",
    "row_fingerprint",
    "attempt_count",
    "commit_patient_import_row",
    "commit_historical_import_row",
    "reconcile_import_batch",
    "rollback_import_batch",
  ]) {
    assert.match(sql, new RegExp(marker, "i"));
  }
  assert.match(sql, /v_billing_type.*insurance/is);
  assert.match(sql, /v_billing_type = 'insurance'/i);
  assert.match(sql, /v_primary := null/i);
  assert.match(sql, /row_status = 'imported'.*target_id is not null/is);
  assert.match(sql, /Possible duplicate: matching name and date of birth already exists/i);
  assert.match(sql, /historical_transactions/i);
  assert.match(sql, /foreign_key_violation/i);
  assert.match(sql, /rollback_status='blocked'/i);
});

test("import UI no longer requires insurance and resumes through server RPCs", () => {
  const imports = source("../src/domains/imports/ImportsPage.tsx");
  assert.match(imports, /self_pay/);
  assert.match(imports, /historical_transactions/);
  assert.match(imports, /SHA-256|sha256/i);
  assert.match(imports, /source_file_hash/);
  assert.match(imports, /mapping_profile/);
  assert.match(imports, /commit_patient_import_row/);
  assert.match(imports, /commit_historical_import_row/);
  assert.match(imports, /reconcile_import_batch/);
  assert.match(imports, /rollback_import_batch/);
  assert.doesNotMatch(imports, /create_patient_intake/);
});

test("connected operations cover reminders, referral out, records, and compliance screening", () => {
  const sql = migration("complete_patient_engagement_connected_operations");
  for (const table of [
    "appointment_reminders",
    "referral_outs",
    "records_requests",
    "compliance_screenings",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /trg_refresh_default_appointment_reminders/i);
  assert.match(sql, /starts_at - interval '24 hours'/i);

  const page = source("../src/pages/connected-operations.tsx");
  assert.match(page, /Appointment Reminders/);
  assert.match(page, /Referral Out/);
  assert.match(page, /Records Requests/);
  assert.match(page, /Compliance Screening/);

  const app = source("../src/App.tsx");
  assert.match(app, /\/operations\/connected/);
});

test("tenant administration uses narrow admin RPCs and protects the last administrator", () => {
  const sql = migration("secure_tenant_user_administration");
  assert.match(sql, /has_tenant_admin_access/i);
  assert.match(sql, /platform_admin.*practice_admin.*billing_company_admin/is);
  assert.match(sql, /list_tenant_users_admin/i);
  assert.match(sql, /set_tenant_user_roles/i);
  assert.match(sql, /set_tenant_user_status/i);
  assert.match(sql, /last active administrator cannot remove their own administrative role/i);
  assert.match(sql, /Administrators cannot deactivate their own current membership/i);
  assert.match(sql, /tenant_user_roles_updated/i);
  assert.match(sql, /tenant_user_status_updated/i);

  const app = source("../src/App.tsx");
  assert.match(app, /\/administration\/users/);
});

test("document history is visible from the audit workspace", () => {
  const audit = source("../src/pages/audit.tsx");
  assert.match(audit, /document_history/);
  assert.match(audit, /Document History/);
  assert.match(audit, /View snapshot/);
});
