import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const verifier = await readFile(new URL("./verify-api-clinical-authorization.mjs", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function runVerifier(supabaseUrl, apiUrl = "http://127.0.0.1:3001") {
  const env = {
    SUPABASE_URL: supabaseUrl,
    API_BASE_URL: apiUrl,
    PUBLISHABLE_KEY: "synthetic-publishable-key",
    SUPABASE_SECRET_KEY: "synthetic-secret-key",
    E2E_STAFF_EMAIL: "staff@example.test",
    E2E_STAFF_PASSWORD: "synthetic-password",
    E2E_PROVIDER_EMAIL: "provider@example.test",
    E2E_PROVIDER_PASSWORD: "synthetic-password",
    E2E_PATIENT_EMAIL: "patient@example.test",
    E2E_PATIENT_PASSWORD: "synthetic-password",
  };
  // Never contact a service or mutate data during this safety test.
  const fetch = async () => { throw new Error("NETWORK_ATTEMPT"); };
  return new AsyncFunction("process", "fetch", verifier)({ env }, fetch);
}

for (const url of ["https://production.supabase.co", "http://localhost.example.com", "http://192.168.1.10:54321"]) {
  test(`rejects remote Supabase before any request: ${url}`, async () => {
    await assert.rejects(runVerifier(url), /restricted to the isolated local/);
  });
}

test("rejects a remote API even when Supabase is local", async () => {
  await assert.rejects(runVerifier("http://127.0.0.1:54321", "https://production.example.com"), /restricted to the isolated local/);
});

for (const host of ["localhost", "127.0.0.1"]) {
  test(`permits the isolated local stack: ${host}`, async () => {
    await assert.rejects(runVerifier(`http://${host}:54321`, `http://${host}:3001`), /NETWORK_ATTEMPT/);
  });
}
