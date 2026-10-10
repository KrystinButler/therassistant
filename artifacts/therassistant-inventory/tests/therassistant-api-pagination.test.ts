import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/lib/therassistant-api.ts", import.meta.url)), "utf8");

test("direct Supabase row reads page through the full result set", () => {
  assert.match(source, /const SUPABASE_PAGE_SIZE\s*=\s*1000/);
  assert.match(source, /Range:\s*`\$\{offset\}-\$\{offset \+ SUPABASE_PAGE_SIZE - 1\}`/);
  assert.match(source, /rows\.push\(\.\.\.data\)/);
  assert.match(source, /if \(data\.length < SUPABASE_PAGE_SIZE\) break/);
});
