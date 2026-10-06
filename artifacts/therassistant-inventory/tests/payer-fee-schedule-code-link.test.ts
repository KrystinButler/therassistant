import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/pages/payer-detail.tsx"), "utf8");

test("fee schedule rate entry uses the canonical CPT/HCPCS selector", () => {
  assert.match(page, /ProcedureCodeSearchInput/);
  assert.match(page, /CPT \/ HCPCS Code/);
  assert.match(page, /cpt_code:\s*form\.cpt_code\.trim\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(page, /<Input label="CPT Code"/);
});
