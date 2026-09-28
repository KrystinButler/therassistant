import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Load the real TSX view without CSS or the network-only repository dependency.
const rpcFixtureUrl = 'data:text/javascript,' + encodeURIComponent('let handler; export function configure(fn){handler=fn} export function portalRpc(name){return handler(name)}');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './portal-client') return { url: rpcFixtureUrl, shortCircuit: true };
    if (specifier.endsWith(".css")) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    if (specifier === './repository' && context.parentURL?.endsWith('PatientPortalPage.tsx')) {
      return { url: 'data:text/javascript,export function getPatientPortalData(){throw Error("Unexpected network call")};export function recordCheckIn(){throw Error("Unexpected write")}', shortCircuit: true };
    }
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx']) {
        const url = new URL(specifier + ext, context.parentURL);
        try { readFileSync(url); return { url: url.href, shortCircuit: true }; } catch {}
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    if (/\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { PatientPortalView } = await import('../src/domains/portal/PatientPortalPage.tsx');
const { buildPatientPortalData } = await import('../src/domains/portal/workflow.ts');
const { Router } = await import('wouter');
const data = {
  ...buildPatientPortalData({ patient: { id: 'synthetic', first_name: 'Test' },
    appointments: ['confirmed', 'client_on_my_way', 'client_arrived', 'checked_in'].map((appointment_status, i) => ({ id: `visit-${i + 1}`, starts_at: `2099-01-0${i + 1}T17:00:00Z`, ends_at: `2099-01-0${i + 1}T18:00:00Z`, appointment_status })),
    policies: [], documents: [], checkins: [], journalEntries: [], now: new Date('2098-01-01') }),
  treatmentGoals: [], provider: null,
};
function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(Router, { ssrPath: '/patient-portal' }, React.createElement(PatientPortalView, { data, refreshing: false, error: null, working: null, load() {}, checkIn() {}, ...overrides })));
}
test('all eligible appointments have reachable pre-visit links', () => {
  const html = render();
  for (const id of ['visit-1', 'visit-2', 'visit-3', 'visit-4']) assert.ok(html.includes(`/patient-portal/check-in/${id}`), id);
});
test('appointment badges reflect actual workflow statuses', () => {
  const html = render();
  for (const label of ['Confirmed', 'On my way', 'Arrived', 'Checked in']) assert.ok(html.includes(label), label);
});
test('arrival actions remain available and completed steps cannot repeat', () => {
  const html = render({ data: { ...data, checkins: [{ id: 'checkin', appointment_id: 'visit-1', arrived_at: '2099-01-01T16:55:00Z' }] } });
  assert.match(html, /On my way/);
  assert.match(html, /I arrived/);
  assert.match(html, /Check in/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>On my way/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>I arrived/);
});
test('unavailable visits remain excluded while every eligible visit survives', () => {
  const result = buildPatientPortalData({patient: {id:'synthetic'}, appointments: [
    {id:'done', starts_at:'2099-01-01', appointment_status:'completed'},
    ...data.upcomingAppointments], policies:[], documents:[], checkins:[], journalEntries:[], now:new Date('2098-01-01')});
  assert.deepEqual(result.upcomingAppointments.map(x => x.id), ['visit-1','visit-2','visit-3','visit-4']);
});

const rpcFixture = await import(rpcFixtureUrl);
const { getPatientPortalData } = await import('../src/domains/portal/repository.ts');
const payload = { patient: { id: 'synthetic' }, appointments: [], insurancePolicies: [], documents: [], checkins: [], journalEntries: [], balance: null, treatmentGoals: [] };
test('provider summary failure does not block appointments and other patient data', async () => {
  rpcFixture.configure(async (name) => {
    if (name === 'get_my_patient_portal_data') return payload;
    if (name === 'get_my_portal_provider_summary') throw Error('Provider temporarily unavailable');
    throw Error('Unexpected RPC');
  });
  const result = await getPatientPortalData();
  assert.equal(result.patient.id, 'synthetic');
  assert.equal(result.provider, null);
  assert.equal(result.providerUnavailable, true);
});
test('core patient authorization failures still stop portal loading', async () => {
  rpcFixture.configure(async (name) => {
    if (name === 'get_my_patient_portal_data') throw Error('Access denied');
    return null;
  });
  await assert.rejects(getPatientPortalData(), /Access denied/);
});
const workflow = await import('../src/domains/portal/workflow.ts');
test('check-in progress only marks the current saved answers complete', () => {
  assert.equal(workflow.isResponseSaved(null, {focus_today: ''}), false);
  assert.equal(workflow.isResponseSaved({focus_today: ''}, {focus_today: ''}), true);
  assert.equal(workflow.isResponseSaved({focus_today: 'sleep'}, {focus_today: 'work'}), false);
  assert.equal(workflow.isResponseSaved({privacy_acknowledged: false}, {privacy_acknowledged: true}), false);
  assert.equal(workflow.isResponseSaved({privacy_acknowledged: true}, {privacy_acknowledged: true}), true);
});
