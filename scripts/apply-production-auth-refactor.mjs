import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, text) { writeFileSync(path, text); }

const apiPath = 'artifacts/therassistant-inventory/src/lib/therassistant-api.ts';
let api = read(apiPath);
if (!api.includes('authenticatedFetch')) {
  api = api.replace(
    'import { useEffect, useState } from "react";\n',
    'import { useEffect, useState } from "react";\n\nimport { authenticatedFetch, SUPABASE_URL } from "./supabase-client";\nimport { requireActiveTenantId } from "./tenant-session";\n',
  );
  api = api.replace(/const SUPABASE_URL =[\s\S]*?const nativeFetch = globalThis\.fetch\.bind\(globalThis\);\n\n/, '');
  api = api.replace(
    `  const response = await nativeFetch(url, {\n    headers: {\n      apikey: SUPABASE_KEY,\n      Accept: "application/json",\n    },\n  });`,
    `  const response = await authenticatedFetch(url, {\n    headers: { Accept: "application/json" },\n  });`,
  );
  api = api.replace(
    /let demoTenantPromise[\s\S]*?async function referenceRows/,
    `async function tenantRows(table: string) {\n  const tenantId = requireActiveTenantId();\n  return supabaseRows(table, { tenant_id: \`eq.\${tenantId}\` });\n}\n\nasync function referenceRows`,
  );
}

// Remove the retired demo-control API surface. Production tenant context comes
// exclusively from the authenticated session and tenant membership tables.
api = api.replace(/\nasync function demoStatus\(\) \{[\s\S]*?\n\}\n\nfunction isDirectPath/, '\nfunction isDirectPath');
api = api.replace('    "/api/demo-control/status",\n', '');
api = api.replace(/\n  if \(pathname === "\/api\/demo-control\/status"\) \{\n    return \(await demoStatus\(\)\) as T;\n  \}\n/, '\n');
api = api.replace(/\n      if \(\n        method === "POST" &&\n        parsed\.pathname === "\/api\/demo-control\/reset"\n      \) \{[\s\S]*?\n      \}\n/, '\n');
if (!api.includes('const nativeFetch = globalThis.fetch.bind(globalThis);')) {
  api = api.replace(
    'import { requireActiveTenantId } from "./tenant-session";\n',
    'import { requireActiveTenantId } from "./tenant-session";\n\nconst nativeFetch = globalThis.fetch.bind(globalThis);\n',
  );
}
write(apiPath, api);

const mailroomPath = 'artifacts/therassistant-inventory/src/domains/mailroom/repository.ts';
let mailroom = read(mailroomPath);
const mailroomReplacements = [
  ['../../lib/supabase-demo-client', '../../lib/tenant-data-client'],
  ['../../lib/supabase-demo-storage', '../../lib/storage-client'],
  ['demoInsert', 'tenantInsert'],
  ['demoRpc', 'tenantRpc'],
  ['demoSelect', 'tenantSelect'],
  ['demoUpdateExact', 'tenantUpdateExact'],
  ['demoUpdate', 'tenantUpdate'],
  ['getDemoTenantId', 'getCurrentTenantId'],
  ['demoStorage', 'storageClient'],
];
for (const [from, to] of mailroomReplacements) mailroom = mailroom.replaceAll(from, to);
if (!mailroom.includes('const tenantId = await getCurrentTenantId();')) {
  mailroom = mailroom.replace(
    'async function loadReferenceRows(): Promise<MailroomReferenceData> {\n  const [clients, providers, payers, claims, authorizations, appeals, documents, assignees] = await Promise.all([',
    'async function loadReferenceRows(): Promise<MailroomReferenceData> {\n  const tenantId = await getCurrentTenantId();\n  const [clients, providers, payers, claims, authorizations, appeals, documents, assignees] = await Promise.all([',
  );
}
mailroom = mailroom.replace(
  'tenantRpc<AssigneeRow[]>("get_demo_mailroom_assignees")',
  'tenantRpc<AssigneeRow[]>("get_mailroom_assignees", { p_tenant_id: tenantId })',
);
mailroom = mailroom.replaceAll('transition_demo_mailroom_item', 'transition_mailroom_item');
write(mailroomPath, mailroom);

const srcRoot = 'artifacts/therassistant-inventory/src';
const sourcePaths = [];
function collectSourceFiles(root) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) collectSourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry)) sourcePaths.push(path);
  }
}
collectSourceFiles(srcRoot);

const clientSymbolReplacements = [
  ['demoUpdateExact', 'tenantUpdateExact'],
  ['demoInsert', 'tenantInsert'],
  ['demoSelect', 'tenantSelect'],
  ['demoUpdate', 'tenantUpdate'],
  ['demoRpc', 'tenantRpc'],
  ['getDemoTenantId', 'getCurrentTenantId'],
];
const storageSymbolReplacements = [
  ['createDemoStorage', 'createStorageClient'],
  ['demoStorage', 'storageClient'],
];
const unsupportedClientExports = [
  'createDemoClient',
  'SUPABASE_PUBLISHABLE_KEY',
];

let migratedFiles = 0;
for (const path of sourcePaths) {
  let text = read(path);
  const original = text;
  const hadClient = text.includes('supabase-demo-client');
  const hadStorage = text.includes('supabase-demo-storage');
  const hadDemoData = /["'][^"']*demo-data["']/.test(text);

  if (hadClient) {
    for (const symbol of unsupportedClientExports) {
      const importPattern = new RegExp(`import[\\s\\S]*?\\b${symbol}\\b[\\s\\S]*?from ["'][^"']*supabase-demo-client["']`);
      if (importPattern.test(text)) {
        throw new Error(`${path} imports unsupported legacy export ${symbol}`);
      }
    }
    text = text.replaceAll('supabase-demo-client', 'tenant-data-client');
  }

  if (hadStorage) {
    text = text.replaceAll('supabase-demo-storage', 'storage-client');
    for (const [from, to] of storageSymbolReplacements) text = text.replaceAll(from, to);
  }

  if (hadDemoData) {
    text = text.replaceAll('demo-data', 'tenant-data-client');
    text = text.replaceAll('demoRows', 'tenantSelect');
    text = text.replaceAll('referenceRows', 'referenceSelect');
  }

  // These legacy adapter names are forbidden anywhere in production staff
  // source, including source-inspection contract tests.
  for (const [from, to] of clientSymbolReplacements) text = text.replaceAll(from, to);

  if (text !== original) {
    write(path, text);
    migratedFiles += 1;
  }
}

const forbiddenMarkers = [
  'supabase-demo-client',
  'supabase-demo-storage',
  'demoInsert',
  'demoSelect',
  'demoUpdate',
  'demoRpc',
  'demoTenant',
];
const forbiddenFiles = [];
for (const path of sourcePaths) {
  const text = read(path);
  for (const marker of forbiddenMarkers) {
    if (text.includes(marker)) forbiddenFiles.push(`${path}: ${marker}`);
  }
}
if (forbiddenFiles.length) {
  throw new Error(`Legacy production markers remain:\n${forbiddenFiles.join('\n')}`);
}

const navigationPath = 'artifacts/therassistant-inventory/src/navigation/sections.ts';
let navigation = read(navigationPath);
navigation = navigation.replace(
  /\n      \{\n        id: "database-inventory",\n        label: "Database Inventory",\n        href: "\/administration\/database-inventory",\n        visibility: visibleToAll,\n      \},/,
  '',
);
write(navigationPath, navigation);

const htmlPath = 'artifacts/therassistant-inventory/index.html';
let html = read(htmlPath);
html = html
  .replaceAll('Therassistant | Revenue Cycle & EHR Demo', 'Therassistant | EHR & Revenue Cycle Operations')
  .replace('Therassistant is a connected behavioral-health EHR and revenue-cycle operations demonstration using synthetic data.', 'Therassistant is a connected behavioral-health EHR and revenue-cycle operations platform.')
  .replace('Connected clinical, payer, credentialing, claims, payment, denial, and revenue-cycle workflows using synthetic demonstration data.', 'Connected clinical, payer, credentialing, claims, payment, denial, and revenue-cycle workflows.')
  .replace('Connected clinical and revenue-cycle operations using synthetic demonstration data.', 'Connected clinical and revenue-cycle operations.');
write(htmlPath, html);

const portalPagePath = 'artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx';
if (existsSync(portalPagePath)) {
  let portalPage = read(portalPagePath);
  portalPage = portalPage
    .replace('PATIENT PORTAL · SYNTHETIC DEMO', 'PATIENT PORTAL')
    .replace('Demographic changes are handled through the practice workflow in this demo; the portal deliberately does not expose administrative fields.', 'Demographic changes are handled through the practice workflow; the portal does not expose administrative fields.');
  write(portalPagePath, portalPage);
}

for (const path of [
  'artifacts/therassistant-inventory/src/pages/demo-control.tsx',
  'artifacts/therassistant-inventory/src/lib/demo-data.ts',
  'artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts',
  'artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts',
]) {
  if (existsSync(path)) rmSync(path);
}

console.log(`Production auth refactor finalized. Migrated ${migratedFiles} remaining source files.`);
