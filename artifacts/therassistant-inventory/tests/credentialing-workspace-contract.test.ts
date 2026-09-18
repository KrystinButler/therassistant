import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const providerDetail = readFileSync(
  new URL("../src/pages/provider-detail.tsx", import.meta.url),
  "utf8",
);

test("credentialing workspace uses normalized operational views and universal workqueue", () => {
  assert.match(credentialingPage, /tenantSelect\("v_credentialing_case_summary"\)/);
  assert.match(credentialingPage, /tenantSelect\("v_provider_enrollment_matrix"\)/);
  assert.match(credentialingPage, /tenantSelect\("v_credentialing_expirations"\)/);
  assert.match(credentialingPage, /tenantSelect\("workqueue_items"\)/);

  for (const label of ["Work Queue", "Applications", "Participation Matrix", "Expirations"]) {
    assert.match(credentialingPage, new RegExp(label, "i"));
  }
});

test("credentialing case drawer exposes application workflow context without a second issue system", () => {
  assert.match(credentialingPage, /title="Credentialing Case"/);
  assert.match(credentialingPage, /Overview/);
  assert.match(credentialingPage, /Requirements/);
  assert.match(credentialingPage, /Follow-Up/);
  assert.match(credentialingPage, /History/);
  assert.match(credentialingPage, /credentialing_requirements/);
  assert.match(credentialingPage, /credentialing_followups/);
  assert.match(credentialingPage, /status_history/);
  assert.doesNotMatch(credentialingPage, /credentialing_issues/);
});

test("Provider 360 consumes the normalized credentialing profile sources", () => {
  assert.match(providerDetail, /tenantSelect\("provider_credentials"/);
  assert.match(providerDetail, /tenantSelect\("v_credentialing_case_summary"/);
  assert.match(providerDetail, /tenantSelect\("v_credentialing_expirations"/);
  assert.match(providerDetail, /CAQH/i);
  assert.match(providerDetail, /Credentials (?:&|&amp;) Licenses/i);
  assert.match(providerDetail, /Credentialing Applications/i);
});
