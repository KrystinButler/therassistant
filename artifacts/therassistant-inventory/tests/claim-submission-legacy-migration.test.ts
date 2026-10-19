import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261010022215_harden_audit_and_edi_submission_lineage.sql", import.meta.url),
  "utf8",
);

test("optional legacy claim columns are checked before backfilling on a fresh database", () => {
  assert.match(migration, /column_name\s*=\s*'Encounter'/);
  assert.match(migration, /column_name\s*=\s*'client'/);
  assert.doesNotMatch(migration, /set encounter_id=coalesce\(encounter_id,"Encounter"\)/);
  assert.match(migration, /from public\.professional_claims pc where pc\.id=cs\.claim_id/);
});
