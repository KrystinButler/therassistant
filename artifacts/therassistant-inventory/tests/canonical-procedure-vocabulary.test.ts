import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../../../supabase/migrations/20261006221500_connect_fee_schedules_to_canonical_service_codes.sql"),
  "utf8",
);

test("searchable HCPCS codes are synchronized into the canonical procedure-code parent before foreign keys are enforced", () => {
  assert.match(migration, /from public\.hcpcs_codes h/i);
  assert.match(migration, /insert into public\.cpt_codes/i);
  assert.match(migration, /'HCPCS'::text as code_system|"code_system",\s*"HCPCS"|jsonb_build_object\([^)]*'code_system'\s*,\s*'HCPCS'/is);
  assert.match(migration, /on conflict \(code\)/i);

  const hcpcsSync = migration.search(/from public\.hcpcs_codes h/i);
  const firstCanonicalFk = migration.search(/foreign key \([^)]*\) references public\.cpt_codes\(code\)/i);
  assert.ok(hcpcsSync >= 0 && firstCanonicalFk > hcpcsSync, "HCPCS synchronization must run before canonical foreign keys are added");
});
