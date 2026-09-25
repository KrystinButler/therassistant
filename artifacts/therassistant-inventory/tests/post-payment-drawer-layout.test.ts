import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const form=readFileSync(new URL("../src/domains/payments/payment-work-drawers.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/domains/payments/post-payment-drawer.css",import.meta.url),"utf8");
test("post-payment drawer groups the three transaction steps and keeps financial posting logic",()=>{
  for(const text of ["Payment received","Apply to account","Reference & audit trail","Post Payment","Trace number","Amount"]) assert.ok(form.includes(text),text);
  assert.match(form,/onSave\(source, form\)/);assert.match(form,/selectedClaim/);assert.match(form,/invalidAllocation/);
  assert.match(css,/@media\(max-width:620px\)/);
});
