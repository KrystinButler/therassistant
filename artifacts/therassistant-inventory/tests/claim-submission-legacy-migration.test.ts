import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261010022215_harden_audit_and_edi_submission_lineage.sql", import.meta.url),
  "utf8",
);
const normalizeLegacyFields = readFileSync(
  new URL("../../../supabase/migrations/20261010022301_normalize_operational_fk_names_and_secure_edi.sql", import.meta.url),
  "utf8",
);

test("optional legacy claim columns are checked before backfilling on a fresh database", () => {
  assert.match(migration, /column_name\s*=\s*'Encounter'/);
  assert.match(migration, /column_name\s*=\s*'client'/);
  assert.doesNotMatch(migration, /set encounter_id=coalesce\(encounter_id,"Encounter"\)/);
  assert.match(migration, /from public\.professional_claims pc where pc\.id=cs\.claim_id/);
});

test("optional legacy operational columns can be absent during initial schema replay", () => {
  for (const legacyName of ["location", "User_id", "Encounter_Id", "plan", "Insurance", "Patient", "Provder_Id", "appointment", "Encounter", "Client", "Appointment"]) {
    assert.ok(normalizeLegacyFields.includes(`->>'${legacyName}'`), `Missing null-safe legacy lookup for ${legacyName}`);
  }
  assert.doesNotMatch(normalizeLegacyFields, /coalesce\(provider_location_id,location\)/);
});
