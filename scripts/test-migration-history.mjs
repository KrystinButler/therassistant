import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('supabase/production-migration-baseline.json', root), 'utf8'));
const files = readdirSync(new URL('supabase/migrations/', root)).filter(name => name.endsWith('.sql'));
test('every applied production migration has its canonical source file', () => {
  const missing = baseline.migrations.filter(({version, name}) => !files.includes(`${version}_${name}.sql`));
  assert.deepEqual(missing, [], 'Production migrations are missing from source control');
});
test('migration versions are unique', () => {
  const versions = files.map(name => name.split('_')[0]);
  assert.equal(new Set(versions).size, versions.length);
});
test('previously applied features are not pending again under alternate timestamps', () => {
  const appliedNames = new Map(baseline.migrations.map(({version,name}) => [name,version]));
  const aliases = files.filter(file => {
    const [,version,name] = /^(\d{14})_(.+)\.sql$/.exec(file) ?? [];
    return appliedNames.has(name) && appliedNames.get(name) !== version && !baseline.migrations.some(m => m.version === version);
  });
  assert.deepEqual(aliases, [], 'Already applied migrations must use their production versions');
});
