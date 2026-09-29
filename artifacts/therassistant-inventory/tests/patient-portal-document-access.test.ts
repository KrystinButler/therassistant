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

test("patient storage policy is read-only and bound to the exact patient-visible document", () => {
  const sql = migration("patient_portal_document_access");
  assert.match(sql, /create policy "Patients can read own portal documents"/i);
  assert.match(sql, /on storage\.objects\s+for select\s+to authenticated/i);
  assert.match(sql, /bucket_id\s*=\s*'therassistant-documents'/i);
  assert.match(sql, /d\.storage_path\s*=\s*storage\.objects\.name/i);
  assert.match(sql, /private\.has_client_portal_access\(d\.tenant_id, d\.client_id\)/i);
  for (const type of ["insurance_card", "intake_form", "consent_form", "client_correspondence", "statement"]) {
    assert.match(sql, new RegExp(`'${type}'`, "i"));
  }
  assert.match(sql, /document_status::text\s+not in\s*\('rejected',\s*'voided'\)/i);
  assert.doesNotMatch(sql, /for insert|for update|for delete/i);
});

test("portal document metadata RPC derives patient authorization from the signed-in identity", () => {
  const sql = migration("patient_portal_document_access");
  assert.match(sql, /create or replace function public\.get_my_portal_document\(p_document_id uuid\)/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /private\.has_client_portal_access\(d\.tenant_id, d\.client_id\)/i);
  assert.doesNotMatch(sql, /p_client_id\s+uuid/i);
  assert.match(sql, /revoke all on function public\.get_my_portal_document\(uuid\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.get_my_portal_document\(uuid\) to authenticated/i);
});

test("patient document actions resolve access through the portal RPC before private Storage", () => {
  const source = readFileSync(new URL("../src/domains/portal/repository.ts", import.meta.url), "utf8");
  assert.match(source, /portalRpc<PortalDocumentAccess \| null>\("get_my_portal_document"/);
  assert.match(source, /storage\/v1\/object\/authenticated/);
  assert.match(source, /openPortalDocument/);
  assert.match(source, /downloadPortalDocument/);
  assert.doesNotMatch(source, /object\/public\/therassistant-documents/);
});

test("patient portal renders explicit Open and Download document actions", () => {
  const source = readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx", import.meta.url), "utf8");
  assert.match(source, />Open<\/button>/);
  assert.match(source, />Download<\/button>/);
  assert.match(source, /documentAction\(id, "open"\)/);
  assert.match(source, /documentAction\(id, "download"\)/);
});
