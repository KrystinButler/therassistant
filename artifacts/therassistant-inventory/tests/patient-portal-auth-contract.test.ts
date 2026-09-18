import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function migration(name: string) {
  const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${name}.sql`));
  assert.ok(file, `missing migration: ${name}`);
  return readFileSync(join(dir, file), "utf8");
}

function functionStatement(sql: string, qualifiedName: string) {
  const marker = `create or replace function ${qualifiedName}(`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `missing function: ${qualifiedName}`);
  const end = sql.indexOf("$;", start);
  assert.notEqual(end, -1, `unterminated function: ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

test("secure patient portal migration defines mapped identity and active-only access", () => {
  const sql = migration("secure_patient_portal_auth");
  assert.match(sql, /create table public\.client_portal_access/i);
  assert.match(sql, /references auth\.users\s*\(id\)/i);
  assert.match(sql, /private\.has_client_portal_access/i);
  assert.match(sql, /status\s*=\s*'active'/i);
  assert.match(sql, /get_my_client_portal_context/i);
  assert.match(sql, /activate_my_client_portal_access/i);
  assert.match(sql, /get_patient_portal_invite_context/i);
  assert.match(sql, /revoke_client_portal_access/i);
  assert.match(sql, /get_my_portal_provider_summary/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon/i);
});

test("patient read policies cover only the approved portal tables", () => {
  const sql = migration("secure_patient_portal_auth");
  for (const table of [
    "clients",
    "appointments",
    "client_insurance_policies",
    "documents",
    "client_checkins",
    "patient_journal_entries",
    "client_balance_summaries",
    "treatment_plans",
    "treatment_plan_goals",
  ]) {
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated`, "i"));
  }

  assert.doesNotMatch(sql, /on public\.providers for select to authenticated[\s\S]*has_client_portal_access/i);
  assert.doesNotMatch(sql, /on public\.clinical_notes for select to authenticated[\s\S]*has_client_portal_access/i);
  assert.doesNotMatch(sql, /on public\.professional_claims for select to authenticated[\s\S]*has_client_portal_access/i);
});

test("provider portal surface is a narrow summary instead of full provider row access", () => {
  const sql = migration("secure_patient_portal_auth");
  assert.match(sql, /get_my_portal_provider_summary\(\)/i);
  assert.match(sql, /'id'.*'first_name'.*'last_name'.*'credentials'.*'primary_specialty'/is);
  assert.doesNotMatch(sql, /grant select on public\.providers to authenticated/i);
});


test("portal policy hardening consolidates staff and patient read paths", () => {
  const sql = migration("secure_patient_portal_auth_hardening");
  assert.match(sql, /client_portal_access_created_by_idx/i);
  for (const legacyPolicy of [
    "appointments patient portal select",
    "balances patient portal select",
    "checkins patient portal select",
    "insurance patient portal select",
    "clients patient portal select",
    "documents patient portal select",
    "treatment plans patient portal select",
    "treatment goals patient portal select",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "${legacyPolicy}"`, "i"));
  }
  assert.match(sql, /private\.has_tenant_read_access\(tenant_id\)[\s\S]+private\.has_client_portal_access/i);
});

test("privileged portal bodies live in private schema behind invoker wrappers", () => {
  const sql = migration("secure_patient_portal_definer_isolation");

  for (const name of [
    "activate_my_client_portal_access",
    "revoke_client_portal_access",
    "get_my_portal_provider_summary",
  ]) {
    const publicWrapper = functionStatement(sql, `public.${name}`);
    const privateImpl = functionStatement(sql, `private.${name}_impl`);

    assert.match(publicWrapper, /security invoker/i);
    assert.doesNotMatch(publicWrapper, /security definer/i);
    assert.match(privateImpl, /security definer/i);
  }
});

test("patient journal uses one combined staff-or-patient read policy", () => {
  const sql = migration("secure_patient_portal_journal_read_policy");
  assert.match(sql, /drop policy if exists "journal patient portal select"/i);
  assert.match(sql, /drop policy if exists "patient_journal_entries tenant select"/i);
  assert.match(sql, /create policy "patient_journal_entries tenant select"/i);
  assert.match(
    sql,
    /private\.has_tenant_read_access\(tenant_id\)[\s\S]+private\.has_client_portal_access\(tenant_id, client_id\)/i,
  );
});


test("patient portal routes are authenticated and contain no patient id authority", () => {
  const app = readFileSync(
    fileURLToPath(new URL("../src/App.tsx", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(app, /patient-portal\/:clientId/i);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /PatientPortalGate/);
  assert.match(app, /PatientPortalLoginPage/);
  assert.match(app, /PatientPortalActivatePage/);
  assert.match(app, /PatientPortalRecoveryPage/);
});

test("auth session preserves invite and recovery flow types", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/lib/supabase-client.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /type AuthFlowType = "invite" \| "recovery" \| null/);
  assert.match(source, /flowType\??:\s*AuthFlowType/);
  assert.match(source, /rawType === "invite" \|\| rawType === "recovery"/);
  assert.match(source, /updatePasswordForCurrentSession/);
  assert.match(source, /allowedFlow/);
  assert.match(source, /redirect_to/);
});

test("patient portal route builders never include client ids", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/domains/portal/routes.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /PORTAL_HOME = "\/patient-portal"/);
  assert.match(source, /PORTAL_LOGIN = "\/patient-portal\/login"/);
  assert.match(source, /PORTAL_ACTIVATE = "\/patient-portal\/activate"/);
  assert.match(source, /PORTAL_RECOVER = "\/patient-portal\/recover"/);
  assert.match(source, /portalCheckInPath\(appointmentId/);
  assert.doesNotMatch(source, /clientId/);
});


test("patient portal pages do not use client ids or the retired public client", () => {
  for (const file of [
    "PatientPortalPage.tsx",
    "PatientCheckInPage.tsx",
    "PatientJournalPage.tsx",
  ]) {
    const source = readFileSync(
      fileURLToPath(new URL(`../src/domains/portal/${file}`, import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(source, /clientId/);
    assert.doesNotMatch(source, /\/patient-portal\/\$\{clientId\}/);
  }

  const publicClient = fileURLToPath(
    new URL("../src/lib/portal-public-client.ts", import.meta.url),
  );
  assert.equal(existsSync(publicClient), false);
});

test("patient portal repository derives the patient from authenticated context", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/domains/portal/repository.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /getMyPortalContext/);
  assert.match(source, /record_client_checkin/);
  assert.match(source, /portal_save_previsit_checkin/);
  assert.match(source, /portal_add_journal_entry/);
  assert.doesNotMatch(source, /portal-public-client/);
  assert.doesNotMatch(source, /getPatientPortalData\(patientId/);
});
