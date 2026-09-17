import test from "node:test";
import assert from "node:assert/strict";

import { buildFilterQuery } from "../src/lib/tenant-data-client.ts";
import {
  getActiveTenantId,
  requireActiveTenantId,
  setActiveTenantId,
} from "../src/lib/tenant-session.ts";

test("buildFilterQuery encodes PostgREST filters", () => {
  assert.equal(
    buildFilterQuery({ client_id: "eq.abc", limit: "1" }),
    "client_id=eq.abc&limit=1",
  );
});

test("tenant session refuses staff data access without an active organization", () => {
  setActiveTenantId(null);
  assert.equal(getActiveTenantId(), null);
  assert.throws(() => requireActiveTenantId(), /No active Therassistant organization/);
});

test("tenant session returns the active organization id", () => {
  setActiveTenantId("tenant-1");
  assert.equal(requireActiveTenantId(), "tenant-1");
  setActiveTenantId(null);
});
