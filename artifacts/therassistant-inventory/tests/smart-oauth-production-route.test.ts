import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("production routes SMART token endpoint before the SPA fallback", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.ok(Array.isArray(vercel.rewrites));
  assert.deepEqual(vercel.rewrites[0], {
    source: "/api/oauth/token",
    destination:
      "https://lpjwfdvaxobewxcklenl.supabase.co/functions/v1/smart-oauth-token",
  });
  assert.deepEqual(vercel.rewrites.at(-1), {
    source: "/(.*)",
    destination: "/index.html",
  });
});

test("SMART OAuth Edge Function uses custom client assertion auth", () => {
  const source = readFileSync(
    "supabase/functions/smart-oauth-token/index.ts",
    "utf8",
  );
  const config = readFileSync("supabase/config.toml", "utf8");

  assert.match(
    source,
    /https:\/\/therassistant\.vercel\.app\/api\/oauth\/token/,
  );
  assert.match(source, /SUPABASE_DB_URL/);
  assert.match(source, /private\.smart_backend_clients/);
  assert.match(source, /SMART_ASSERTION_MAX_LIFETIME_SECONDS = 300/);
  assert.match(config, /\[functions\.smart-oauth-token\][\s\S]*verify_jwt = false/);
});
