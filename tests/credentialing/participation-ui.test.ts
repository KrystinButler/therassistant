import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = "artifacts/therassistant-inventory/src/domains/credentialing/ParticipationVerificationPage.tsx";
const apiPath = "artifacts/therassistant-inventory/src/domains/credentialing/participation-api.ts";
const modulePath = "artifacts/therassistant-inventory/src/domains/credentialing/CredentialingModuleApp.tsx";

async function text(path: string) {
  return readFile(path, "utf8");
}

test("participation workspace follows provider practice location payer plan network sequence", async () => {
  const page = await text(pagePath);
  for (const label of ["Provider", "Practice", "Location", "Payer", "Plan", "Network"]) {
    assert.match(page, new RegExp(`>${label}<|${label}`));
  }
  assert.match(page, /Verify Participation/);
  assert.match(page, /verification in progress/i);
});

test("NOT_FOUND copy never labels the provider out of network", async () => {
  const page = await text(pagePath);
  assert.match(page, /does not establish that the provider is out-of-network/i);
  assert.doesNotMatch(page, /status[^\n]{0,40}OUT_OF_NETWORK|status[^\n]{0,40}out_of_network/i);
});

test("results expose confidence freshness evidence and official fallback", async () => {
  const page = await text(pagePath);
  assert.match(page, /confidence/i);
  assert.match(page, /source_updated_at|sourceUpdatedAt/);
  assert.match(page, /View Evidence/);
  assert.match(page, /Open Official Payer Directory/);
  assert.match(page, /verification-history|loadVerificationHistory/);
});

test("client uses authenticated versioned API and polls async results", async () => {
  const api = await text(apiPath);
  assert.match(api, /authenticatedFetch/);
  assert.match(api, /\/api\/v1\/participation-verifications/);
  assert.match(api, /\/api\/v1\/payers/);
  assert.match(api, /IN_PROGRESS/);
  assert.match(api, /setTimeout/);
});

test("credentialing module owns a participation verification route", async () => {
  const module = await text(modulePath);
  assert.match(module, /ParticipationVerificationPage/);
  assert.match(module, /\/credentialing\/participation/);
  assert.match(module, /Verify Participation/);
});
