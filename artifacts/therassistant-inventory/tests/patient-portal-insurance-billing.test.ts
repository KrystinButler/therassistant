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

test("patient insurance uploads are restricted to the patient path and card file types", () => {
  const sql = migration("patient_portal_insurance_upload_and_billing");
  assert.match(sql, /create policy "Patients can upload own insurance cards"/i);
  assert.match(sql, /on storage\.objects\s+for insert\s+to authenticated/i);
  assert.match(sql, /portal-insurance/i);
  assert.match(sql, /storage\.extension\(name\)/i);
  for (const extension of ["pdf", "jpg", "jpeg", "png", "webp"]) {
    assert.match(sql, new RegExp(`'${extension}'`, "i"));
  }
  assert.match(sql, /client_portal_access/i);
  assert.match(sql, /cpa\.user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /cpa\.tenant_id::text\s*=\s*\(storage\.foldername/i);
  assert.match(sql, /cpa\.client_id::text\s*=\s*\(storage\.foldername/i);
});

test("patients can only delete an unlinked upload during failed registration cleanup", () => {
  const sql = migration("patient_portal_insurance_upload_and_billing");
  assert.match(sql, /create policy "Patients can clean up unlinked insurance uploads"/i);
  assert.match(sql, /on storage\.objects\s+for delete\s+to authenticated/i);
  assert.match(sql, /not exists\s*\(\s*select 1\s*from public\.documents d\s*where d\.storage_path = storage\.objects\.name/i);
});

test("insurance card registration creates a pending chart document and staff work without patient document table writes", () => {
  const sql = migration("patient_portal_insurance_upload_and_billing");
  assert.match(sql, /private\.portal_register_insurance_card_impl/i);
  assert.match(sql, /'insurance_card'::public\.document_type_enum/i);
  assert.match(sql, /'pending_review'::public\.document_status_enum/i);
  assert.match(sql, /insert into public\.mailroom_items/i);
  assert.match(sql, /insert into public\.workqueue_items/i);
  assert.match(sql, /create or replace function public\.portal_register_insurance_card/i);
  assert.match(sql, /security invoker/i);
});

test("portal billing summary exposes only patient-sourced payments", () => {
  const sql = migration("patient_portal_insurance_upload_and_billing");
  assert.match(sql, /get_my_portal_billing_summary_impl/i);
  assert.match(sql, /p\.payment_source\s*=\s*'patient'::public\.payment_source_enum/i);
  assert.match(sql, /p\.payment_status\s*<>\s*'voided'::public\.payment_status_enum/i);
  assert.match(sql, /'amount_cents'/i);
  assert.match(sql, /'payment_method'/i);
  assert.match(sql, /'payment_status'/i);
  assert.doesNotMatch(sql, /'trace_number'/i);
  assert.doesNotMatch(sql, /'check_number'/i);
  assert.doesNotMatch(sql, /'notes'/i);
});

test("portal repository and page wire insurance upload, billing history, and appointment history", () => {
  const repository = readFileSync(new URL("../src/domains/portal/repository.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx", import.meta.url), "utf8");
  assert.match(repository, /uploadPortalInsuranceCard/);
  assert.match(repository, /portal_register_insurance_card/);
  assert.match(repository, /get_my_portal_billing_summary/);
  assert.match(page, /Upload insurance card/);
  assert.match(page, /Payment History/);
  assert.match(page, /Appointment History/);
  assert.match(page, /statementDocuments/);
});
