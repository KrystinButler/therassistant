import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maxScore, validateScore } from "../src/domains/treatment-plans/outcome-review-model.ts";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/20261010203000_cross_system_clinical_engine.sql", import.meta.url));

test("PRSDS is a 1-10 patient-reported metric", () => {
  assert.equal(maxScore("PRSDS"), 10);
  assert.equal(validateScore("PRSDS", 1), true);
  assert.equal(validateScore("PRSDS", 10), true);
  assert.equal(validateScore("PRSDS", 0), false);
  assert.equal(validateScore("PRSDS", 11), false);
});

test("cross-system migration extends outcome measures and creates auditable coding decisions", () => {
  assert.equal(existsSync(migrationPath), true);
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /instrument\s+in\s*\([^)]*'PRSDS'/i);
  assert.match(sql, /instrument='PRSDS'\s+and\s+score\s+between\s+1\s+and\s+10/i);
  assert.match(sql, /create table if not exists public\.clinical_cross_mapping_config/i);
  assert.match(sql, /Somatic_MentalHealth_SUD_CrossMapping_Engine/);
  assert.match(sql, /create table if not exists public\.clinical_cross_mapping_decisions/i);
  assert.match(sql, /action text not null check\s*\(action in \('accepted','rejected'\)\)/i);
  assert.match(sql, /rejection_justification/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /private\.has_tenant_read_access/i);
  assert.match(sql, /private\.has_tenant_write_access/i);
});
