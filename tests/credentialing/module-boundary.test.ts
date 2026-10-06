import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiRoot = "artifacts/therassistant-inventory/src";
const apiRoot = "artifacts/api-server/src";

test("EHR mounts credentialing only through the module entry point", async () => {
  const app = await readFile(`${uiRoot}/App.tsx`, "utf8");

  assert.match(app, /CredentialingModuleApp/);
  assert.match(app, /location\.startsWith\("\/credentialing"\)/);
  assert.doesNotMatch(app, /domains\/credentialing\/CredentialingPage/);
  assert.doesNotMatch(app, /domains\/credentialing\/PayersContractsPage/);
  assert.doesNotMatch(app, /pages\/payer-detail/);
});

test("EHR shell exposes one credentialing module launcher instead of owning payer and credentialing screens", async () => {
  const shell = await readFile(`${uiRoot}/components/app-shell.tsx`, "utf8");

  assert.match(shell, /Credentialing Module/);
  assert.match(shell, /href: "\/credentialing"/);
  assert.doesNotMatch(shell, /href: "\/payers-contracts"/);
  assert.doesNotMatch(shell, /label: "Payers"/);
  assert.doesNotMatch(shell, /label: "Credentialing",/);
});

test("EHR Provider 360 does not read or mutate credentialing-owned records", async () => {
  const providerDetail = await readFile(`${uiRoot}/pages/provider-detail.tsx`, "utf8");

  for (const forbidden of [
    /provider_payer_enrollments/i,
    /provider_credentials/i,
    /provider_identifiers/i,
    /v_credentialing_/i,
    /buildProviderCredentialingView/i,
    /PayerIntelligencePanel/i,
    /domains\/credentialing/i,
  ]) {
    assert.doesNotMatch(providerDetail, forbidden);
  }

  assert.match(providerDetail, /Open Credentialing Module/);
  assert.match(providerDetail, /workqueue_type[^\n]+credentialing_issue/);
});

test("credentialing frontend owns its application and payer routes", async () => {
  const moduleApp = await readFile(`${uiRoot}/domains/credentialing/CredentialingModuleApp.tsx`, "utf8");

  assert.match(moduleApp, /CredentialingPage/);
  assert.match(moduleApp, /PayersContractsPage/);
  assert.match(moduleApp, /\/credentialing\/payers\/:id/);
  assert.match(moduleApp, /THERASSISTANT/);
  assert.match(moduleApp, /CREDENTIALING/);
  assert.doesNotMatch(moduleApp, /ClaimsPage|BillingQueuePage|Claim360Page/);
});

test("API root mounts credentialing through one module facade", async () => {
  const routeIndex = await readFile(`${apiRoot}/routes/index.ts`, "utf8");
  const moduleRouter = await readFile(`${apiRoot}/modules/credentialing/router.ts`, "utf8");

  assert.match(routeIndex, /\.\.\/modules\/credentialing\/router/);
  assert.doesNotMatch(routeIndex, /from "\.\/credentialing"/);
  assert.doesNotMatch(routeIndex, /from "\.\/credentialing-medicare"/);
  assert.match(moduleRouter, /credentialingRouter/);
  assert.match(moduleRouter, /credentialingMedicareRouter/);
});

test("credentialing backend cannot mutate or gate professional claims", async () => {
  const [credentialing, medicare] = await Promise.all([
    readFile(`${apiRoot}/routes/credentialing.ts`, "utf8"),
    readFile(`${apiRoot}/routes/credentialing-medicare.ts`, "utf8"),
  ]);
  const source = `${credentialing}\n${medicare}`;

  assert.doesNotMatch(source, /INSERT\s+INTO\s+professional_claims/i);
  assert.doesNotMatch(source, /UPDATE\s+professional_claims/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+professional_claims/i);
  assert.doesNotMatch(source, /claim_status\s*=/i);
});
