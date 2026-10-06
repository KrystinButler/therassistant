import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/pages/payer-detail.tsx"), "utf8");

test("payer 360 exposes imported reference fee rates with canonical service labels", () => {
  assert.match(page, /referenceSelect<Row>\("reference_fee_rates"/);
  assert.match(page, /referenceSelect<Row>\("cpt_codes"/);
  assert.match(page, /Reference Fee Rates/);
  assert.match(page, /provider_level/);
  assert.match(page, /display_name/);
  assert.match(page, /reference library/i);
});
