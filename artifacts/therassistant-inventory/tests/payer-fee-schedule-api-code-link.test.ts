import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, "../../api-server/src/routes/payers.ts"), "utf8");

test("fee schedule API normalizes and validates canonical CPT/HCPCS codes", () => {
  assert.match(route, /const canonicalCode = cptCode\.toUpperCase\(\)/);
  assert.match(route, /JOIN cpt_codes cc ON cc\.code = \$\{canonicalCode\}/);
  assert.match(route, /cc\.is_active = true/);
  assert.match(route, /fs\.id, \$\{canonicalCode\}/);
});
