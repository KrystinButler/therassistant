import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20260923194822_restore_canonical_claim_validation.sql", import.meta.url)),
  "utf8",
);

test("canonical claim validation no longer delegates to the removed legacy validator", () => {
  assert.match(migration, /create or replace function public\.rcm_validate_claim\(p_claim_id uuid\)/);
  assert.doesNotMatch(migration, /return\s+public\.validate_claim\(/i);
  assert.match(migration, /Rendering provider is not approved with the payer\./);
  assert.match(migration, /Claim lines require service date, CPT\/HCPCS/);
  assert.match(migration, /grant execute on function public\.rcm_validate_claim\(uuid\) to authenticated/);
});
