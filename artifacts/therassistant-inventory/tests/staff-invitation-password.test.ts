import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

test('verified EHR invitation can set its password without a patient mapping', async () => {
  const source = readFileSync(new URL('../src/lib/supabase-client.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source.replace('import.meta.env ?? {}', '{}'));
  const storage = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls: string[] = [];
  const user = { id: 'synthetic-staff', email: 'staff@example.test' };
  storage.set('therassistant.auth.session.v1', JSON.stringify({
    access_token: 'synthetic', refresh_token: 'synthetic-refresh',
    expires_at: Math.floor(Date.now()/1000) + 3600, flowType: 'invite', user,
  }));
  globalThis.window = {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    location: { hash: '' }, addEventListener() {},
  } as any;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    return new Response(JSON.stringify(path.endsWith('get_my_client_portal_context') ? null : user), { status: 200 });
  };
  try {
    const client = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const session = await client.updatePasswordForCurrentSession('Synthetic-password-123!', 'staff_invite');
    assert.equal(session.user.id, user.id);
    assert.ok(calls.includes('PUT /auth/v1/user'));
    assert.ok(!calls.some(call => call.includes('activate_my_client_portal_access')));
    client.clearAuthFlowType();
    assert.equal(JSON.parse(storage.get('therassistant.auth.session.v1')!).flowType, null);
    await assert.rejects(client.updatePasswordForCurrentSession('Synthetic-password-123!', 'staff_invite'), /invitation session/i);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
