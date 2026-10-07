import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesPath = "artifacts/api-server/src/modules/credentialing/verification-routes.ts";
const moduleRouterPath = "artifacts/api-server/src/modules/credentialing/router.ts";
const catalogRoutesPath = "artifacts/api-server/src/modules/credentialing/catalog-routes.ts";

async function text(path: string) {
  return readFile(path, "utf8");
}

test("versioned participation API is authenticated and tenant-derived", async () => {
  const routes = await text(routesPath);
  assert.match(routes, /requireAuthenticatedTenant/);
  assert.match(routes, /getTenantAuthContext/);
  assert.match(routes, /router\.post\(\s*["']\/v1\/participation-verifications["']/s);
  assert.match(routes, /status\(202\)/);
  assert.match(routes, /IN_PROGRESS/);
  assert.match(routes, /enqueueVerification/);
  assert.doesNotMatch(routes, /req\.body\?\.tenant_id|req\.body\.tenant_id/);
});

test("verification creation validates provider, organization, location, plan and network scope", async () => {
  const routes = await text(routesPath);
  for (const token of [
    "provider_id",
    "organization_id",
    "practice_location_id",
    "payer_id",
    "plan_id",
    "network_id",
    "individual_npi",
  ]) {
    assert.match(routes, new RegExp(token));
  }
  assert.match(routes, /tenant_id\s*=\s*\$\{tenantId\}/);
  assert.match(routes, /pp\.payer_id/);
  assert.match(routes, /pn\.plan_id/);
});

test("versioned verification read APIs expose result and immutable history", async () => {
  const routes = await text(routesPath);
  assert.match(routes, /\/v1\/participation-verifications\/:id/);
  assert.match(routes, /\/v1\/providers\/:providerId\/participation/);
  assert.match(routes, /\/v1\/providers\/:providerId\/verification-history/);
  assert.match(routes, /participation_verification_evidence/);
  assert.match(routes, /participation_verification_matches/);
});

test("credentialing facade mounts verification routes and versioned paths are not double-prefixed", async () => {
  const [router, catalog] = await Promise.all([
    text(moduleRouterPath),
    text(catalogRoutesPath),
  ]);
  assert.match(router, /verificationRoutes/);
  assert.doesNotMatch(catalog, /["']\/api\/v1\//);
  assert.match(catalog, /["']\/v1\/payers["']/);
});
