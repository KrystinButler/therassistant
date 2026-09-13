import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFilterQuery,
  createDemoClient,
} from "../src/lib/supabase-demo-client.ts";

test("buildFilterQuery encodes PostgREST filters", () => {
  assert.equal(
    buildFilterQuery({ client_id: "eq.abc", limit: "1" }),
    "client_id=eq.abc&limit=1",
  );
});

test("demo client surfaces a plain-language Supabase error", async () => {
  const fakeFetch = async () =>
    new Response("permission denied", {
      status: 403,
      statusText: "Forbidden",
    });

  const client = createDemoClient(fakeFetch as typeof fetch);

  await assert.rejects(
    () => client.referenceSelect("payers"),
    /Supabase payers request failed \(403\): permission denied/,
  );
});
