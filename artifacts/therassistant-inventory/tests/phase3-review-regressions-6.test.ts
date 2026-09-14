import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sourceRouteForWorkItem } from "../src/domains/work-center/repository.ts";

const finalReversalHardeningUrl = new URL(
  "../../../supabase/migrations/20260914_phase3_finalize_atomic_reversal_permissions.sql",
  import.meta.url,
);

test("final reversal privilege hardening runs after legacy Phase 3 grants", () => {
  assert.equal(existsSync(finalReversalHardeningUrl), true);
  if (!existsSync(finalReversalHardeningUrl)) return;

  const sql = readFileSync(finalReversalHardeningUrl, "utf8");
  assert.match(sql, /revoke\s+update\s*\(\s*reversed_at\s*\)\s+on\s+table\s+public\.payment_allocations\s+from\s+anon/i);
  assert.match(sql, /revoke\s+insert\s+on\s+table\s+public\.payment_reversals\s+from\s+anon/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"demo anon payment allocations update"/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"demo anon payment reversals insert"/i);
});

test("charge work items open the moved charge queue", () => {
  assert.equal(sourceRouteForWorkItem("charge", "charge-1"), "/billing/charges");
});
