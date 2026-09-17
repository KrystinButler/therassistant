import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, text) { writeFileSync(path, text); }
function requiredReplace(text, search, replacement, label) {
  if (typeof search === 'string') {
    if (!text.includes(search)) throw new Error(`Missing expected source pattern: ${label}`);
    return text.replace(search, replacement);
  }
  if (!search.test(text)) throw new Error(`Missing expected source pattern: ${label}`);
  return text.replace(search, replacement);
}

const apiPath = 'artifacts/therassistant-inventory/src/lib/therassistant-api.ts';
let api = read(apiPath);
api = requiredReplace(
  api,
  'import { useEffect, useState } from "react";\n',
  'import { useEffect, useState } from "react";\n\nimport { authenticatedFetch, SUPABASE_URL } from "./supabase-client";\nimport { requireActiveTenantId } from "./tenant-session";\n',
  'therassistant-api imports',
);
api = requiredReplace(
  api,
  /const SUPABASE_URL =[\s\S]*?const nativeFetch = globalThis\.fetch\.bind\(globalThis\);\n\n/,
  '',
  'therassistant-api legacy Supabase constants',
);
api = requiredReplace(
  api,
  `  const response = await nativeFetch(url, {\n    headers: {\n      apikey: SUPABASE_KEY,\n      Accept: "application/json",\n    },\n  });`,
  `  const response = await authenticatedFetch(url, {\n    headers: { Accept: "application/json" },\n  });`,
  'therassistant-api anonymous request',
);
api = requiredReplace(
  api,
  /let demoTenantPromise[\s\S]*?async function referenceRows/,
  `async function tenantRows(table: string) {\n  const tenantId = requireActiveTenantId();\n  return supabaseRows(table, { tenant_id: \`eq.\${tenantId}\` });\n}\n\nasync function referenceRows`,
  'therassistant-api demo tenant resolver',
);
write(apiPath, api);

const mailroomPath = 'artifacts/therassistant-inventory/src/domains/mailroom/repository.ts';
let mailroom = read(mailroomPath);
const replacements = [
  ['../../lib/supabase-demo-client', '../../lib/tenant-data-client'],
  ['../../lib/supabase-demo-storage', '../../lib/storage-client'],
  ['demoInsert', 'tenantInsert'],
  ['demoRpc', 'tenantRpc'],
  ['demoSelect', 'tenantSelect'],
  ['demoUpdate', 'tenantUpdate'],
  ['getDemoTenantId', 'getCurrentTenantId'],
  ['demoStorage', 'storageClient'],
];
for (const [from, to] of replacements) {
  if (!mailroom.includes(from)) throw new Error(`Missing expected Mailroom symbol: ${from}`);
  mailroom = mailroom.replaceAll(from, to);
}
write(mailroomPath, mailroom);

const navigationPath = 'artifacts/therassistant-inventory/src/navigation/sections.ts';
let navigation = read(navigationPath);
navigation = requiredReplace(
  navigation,
  /\n      \{\n        id: "database-inventory",\n        label: "Database Inventory",\n        href: "\/administration\/database-inventory",\n        visibility: visibleToAll,\n      \},/,
  '',
  'database inventory navigation item',
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

for (const path of [
  'artifacts/therassistant-inventory/src/pages/demo-control.tsx',
  'artifacts/therassistant-inventory/src/lib/demo-data.ts',
  'artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts',
  'artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts',
]) {
  if (existsSync(path)) rmSync(path);
}

const forbiddenImports = ['supabase-demo-client', 'supabase-demo-storage', 'DemoControlCenter'];
for (const [path, text] of [[apiPath, read(apiPath)], [mailroomPath, read(mailroomPath)]]) {
  for (const marker of forbiddenImports) {
    if (text.includes(marker)) throw new Error(`${path} still contains ${marker}`);
  }
}

console.log('Production auth refactor applied.');
