import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

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
  write(apiPath, api);
}

const mailroomPath = 'artifacts/therassistant-inventory/src/domains/mailroom/repository.ts';
let mailroom = read(mailroomPath);
const symbolReplacements = [
  ['../../lib/supabase-demo-client', '../../lib/tenant-data-client'],
  ['../../lib/supabase-demo-storage', '../../lib/storage-client'],
  ['demoInsert', 'tenantInsert'],
  ['demoRpc', 'tenantRpc'],
  ['demoSelect', 'tenantSelect'],
  ['demoUpdate', 'tenantUpdate'],
  ['getDemoTenantId', 'getCurrentTenantId'],
  ['demoStorage', 'storageClient'],
];
for (const [from, to] of symbolReplacements) mailroom = mailroom.replaceAll(from, to);
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

for (const [path, text] of [[apiPath, read(apiPath)], [mailroomPath, read(mailroomPath)]]) {
  for (const marker of ['supabase-demo-client', 'supabase-demo-storage', 'DemoControlCenter']) {
    if (text.includes(marker)) throw new Error(`${path} still contains ${marker}`);
  }
}

console.log('Production auth refactor finalized.');
