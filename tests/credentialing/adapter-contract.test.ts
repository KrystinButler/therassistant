import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapterTypesPath = "artifacts/api-server/src/modules/credentialing/adapters/types.ts";
const registryPath = "artifacts/api-server/src/modules/credentialing/adapters/registry.ts";
const nppesPath = "artifacts/api-server/src/modules/credentialing/adapters/nppes.ts";
const pecosPath = "artifacts/api-server/src/modules/credentialing/adapters/pecos.ts";

test("every payer adapter exposes catalog sync, participation verification, and health check", async () => {
  const [types, registry] = await Promise.all([
    readFile(adapterTypesPath, "utf8"),
    readFile(registryPath, "utf8"),
  ]);

  assert.match(types, /export interface PayerAdapter/);
  assert.match(types, /syncCatalog\(\)/);
  assert.match(types, /verifyParticipation\(/);
  assert.match(types, /healthCheck\(\)/);
  assert.match(registry, /getPayerAdapter/);
  assert.match(registry, /registerPayerAdapter/);
});

test("NPPES remains identity evidence and PECOS remains Medicare FFS enrollment evidence", async () => {
  const [nppes, pecos] = await Promise.all([
    readFile(nppesPath, "utf8"),
    readFile(pecosPath, "utf8"),
  ]);

  assert.match(nppes, /lookupNppesProvider/);
  assert.match(nppes, /identity/i);
  assert.doesNotMatch(nppes, /providerNetworkRelationshipConfirmed:\s*true/);

  assert.match(pecos, /lookupCmsMedicareEnrollment/);
  assert.match(pecos, /Medicare FFS/i);
  assert.doesNotMatch(pecos, /Medicare Advantage.*PARTICIPATING/i);
});

test("typed adapter failures include every SPEC-1 reliability category", async () => {
  const types = await readFile(adapterTypesPath, "utf8");
  for (const code of [
    "TRANSIENT_NETWORK",
    "RATE_LIMITED",
    "AUTHENTICATION_FAILED",
    "SOURCE_UNAVAILABLE",
    "INVALID_RESPONSE",
    "PROVIDER_NOT_FOUND",
    "PLAN_NOT_FOUND",
    "AMBIGUOUS_RESULT",
  ]) {
    assert.match(types, new RegExp(code));
  }
});
