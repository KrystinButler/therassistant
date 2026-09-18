import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

test("credentialing includes a reports workspace built from normalized sources", () => {
  assert.match(credentialingPage, /\["reports", "Reports"\]/);
  assert.match(credentialingPage, /Credentialing Reports/);
  assert.match(credentialingPage, /Application Aging/);
  assert.match(credentialingPage, /Participation Status/);
  assert.match(credentialingPage, /Expirations/);
  assert.match(credentialingPage, /Roster Status/);
  assert.match(credentialingPage, /Network & Directory Exceptions/);
});

test("credentialing reports export the operational records without a reporting table", () => {
  assert.match(credentialingPage, /exportApplicationAgingCsv/);
  assert.match(credentialingPage, /exportParticipationCsv/);
  assert.match(credentialingPage, /exportExpirationCsv/);
  assert.match(credentialingPage, /exportRosterCsv/);
  assert.doesNotMatch(credentialingPage, /tenantSelect\("credentialing_reports"/);
  assert.doesNotMatch(credentialingPage, /tenantSelect\("reporting_/);
});
