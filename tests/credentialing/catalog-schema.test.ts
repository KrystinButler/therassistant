import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20261007010000_credentialing_plan_network_catalog.sql";
const catalogRoutesPath = "artifacts/api-server/src/modules/credentialing/catalog-routes.ts";
const moduleRouterPath = "artifacts/api-server/src/modules/credentialing/router.ts";

test("credentialing catalog migration is additive, effective-dated, and shared read-only", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE public\.payers[\s\S]*adapter_key/i);
  assert.match(sql, /ALTER TABLE public\.payer_plans[\s\S]*external_plan_id/i);
  assert.match(sql, /CREATE TABLE public\.payer_networks/i);
  assert.match(sql, /CREATE TABLE public\.payer_coverage_areas/i);
  assert.match(sql, /CREATE TABLE public\.payer_catalog_syncs/i);

  for (const field of ["effective_from", "effective_to", "active", "source_updated_at"]) {
    assert.match(sql, new RegExp(field, "i"));
  }

  assert.match(sql, /ALTER TABLE public\.payer_networks ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.payer_coverage_areas ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.payer_catalog_syncs ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FOR SELECT\s+TO authenticated\s+USING \(true\)/i);
  assert.doesNotMatch(sql, /FOR (?:INSERT|UPDATE|DELETE)\s+TO authenticated/i);
  assert.doesNotMatch(sql, /RAE_1|RAE_2|RAE_3|RAE_4|RAE_5|RAE_6|RAE_7/i);
});

test("Colorado ACC Phase III relationships are effective-dated rather than hard-coded as an enum", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /Region 1/i);
  assert.match(sql, /Rocky Mountain Health Plans/i);
  assert.match(sql, /Region 2/i);
  assert.match(sql, /Northeast Health Partners/i);
  assert.match(sql, /Region 3/i);
  assert.match(sql, /Colorado Community Health Alliance/i);
  assert.match(sql, /Region 4/i);
  assert.match(sql, /Colorado Access/i);
  assert.match(sql, /2025-07-01/);
  assert.match(sql, /SELECT[\s\S]+FROM public\.payers/i);
  assert.doesNotMatch(sql, /'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'::uuid/i);
});

test("versioned catalog routes expose active records by default and history explicitly", async () => {
  const [routes, moduleRouter] = await Promise.all([
    readFile(catalogRoutesPath, "utf8"),
    readFile(moduleRouterPath, "utf8"),
  ]);

  assert.match(routes, /router\.get\("\/api\/v1\/payers"/);
  assert.match(routes, /router\.get\("\/api\/v1\/payers\/:payerId\/plans"/);
  assert.match(routes, /router\.get\("\/api\/v1\/plans\/:planId\/networks"/);
  assert.match(routes, /includeInactive/);
  assert.match(routes, /active\s*=\s*true/i);
  assert.match(routes, /state\s*=\s*'CO'/i);
  assert.match(moduleRouter, /catalogRoutes/);
});
