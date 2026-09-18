import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const storageClient = readFileSync(
  new URL("../src/lib/storage-client.ts", import.meta.url),
  "utf8",
);

test("credentialing case drawer exposes document evidence and network verification", () => {
  assert.match(credentialingPage, /Documents/);
  assert.match(credentialingPage, /Network Verification/);
  assert.match(credentialingPage, /tenantSelect\("documents"/);
  assert.match(credentialingPage, /tenantSelect\("credentialing_document_links"/);
  assert.match(credentialingPage, /tenantSelect\("participation_verifications"/);
  assert.match(credentialingPage, /tenantSelect\("provider_network_participation"/);
});

test("credentialing evidence reuses the existing private document store", () => {
  assert.match(credentialingPage, /credentialing_document_links/);
  assert.match(credentialingPage, /document_type/);
  assert.doesNotMatch(credentialingPage, /participation_evidence/);
  assert.match(storageClient, /uploadCredentialingFile/);
  assert.match(storageClient, /therassistant-documents/);
});

test("network verification records participation, directory, source and evidence context", () => {
  for (const field of [
    "verification_method",
    "result",
    "reference_number",
    "representative_name",
    "source_url",
    "directory_status",
    "next_verification_due_date",
  ]) {
    assert.match(credentialingPage, new RegExp(field));
  }
});
