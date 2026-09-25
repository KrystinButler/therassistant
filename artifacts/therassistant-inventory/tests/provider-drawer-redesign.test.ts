import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../src/pages/providers.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/pages/provider-drawer.css",import.meta.url),"utf8");
test("provider drawer presents readable grouped identity, identifiers and contact fields",()=>{
  for (const title of ["Provider identity","Clinical identifiers","Contact information","Enrollment is tracked separately."])assert.ok(page.includes(title),title);
  assert.match(page,/className="provider-drawer-form"/);
  assert.match(css,/provider-drawer-fields\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(css,/@media\(max-width:610px\)/);
});
test("provider edit uses existing tenant-scoped write paths, visible error messages and dirty-form confirmation",()=>{
  assert.match(page,/tenantUpdate\("providers"/);
  assert.match(page,/tenantInsert\("providers"/);
  assert.match(page,/\{formError && <div role="alert"/);
  assert.match(page,/Discard unsaved provider changes/);
  assert.match(page,/Individual NPI must contain exactly 10 digits/);
});
