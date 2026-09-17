import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as patientWorkflow from "../src/domains/patients/workflow.ts";

const here = dirname(fileURLToPath(import.meta.url));
const clientsSource = readFileSync(join(here, "../src/pages/clients.tsx"), "utf8");
const migrationsDir = join(here, "../../../supabase/migrations");

test("new patient creation delegates to one atomic intake RPC", () => {
  assert.match(clientsSource, /tenantRpc<CreatedRow>\(\s*"create_patient_intake"/);
  assert.doesNotMatch(clientsSource, /tenantInsert<CreatedRow>\(\s*"clients"/);
  assert.doesNotMatch(clientsSource, /async function insertCoverage/);
});

test("emergency contact details require a contact name before intake save", () => {
  const validate = (patientWorkflow as Record<string, unknown>).validatePatientIntakeEmergencyContact;
  assert.equal(typeof validate, "function", "patient workflow should expose emergency-contact intake validation");
  if (typeof validate !== "function") return;

  const fn = validate as (input: { name?: string; phone?: string; relationship?: string }) => void;
  assert.throws(
    () => fn({ phone: "303-555-1212", relationship: "Parent" }),
    /Emergency contact name is required/i,
  );
  assert.doesNotThrow(() => fn({ name: "", phone: "", relationship: "" }));
  assert.doesNotThrow(() => fn({ name: "Alex Reed", phone: "303-555-1212", relationship: "Parent" }));
});

test("patient intake migration defines a tenant-scoped invoker RPC", () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes("patient_intake_transaction"));
  assert.ok(migrationName, "patient intake transaction migration should exist");
  const sql = readFileSync(join(migrationsDir, migrationName), "utf8");

  assert.match(sql, /create or replace function public\.create_patient_intake/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /perform public\.assert_tenant_access\(p_tenant_id\)/i);
  assert.match(sql, /insert into public\.clients/i);
  assert.match(sql, /insert into public\.client_contacts/i);
  assert.match(sql, /insert into public\.client_insurance_policies/i);
  assert.match(sql, /revoke all on function public\.create_patient_intake/i);
  assert.match(sql, /grant execute on function public\.create_patient_intake/i);
});
