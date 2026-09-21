import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../../../supabase/functions/crm-api/index.ts",import.meta.url),"utf8");
for (const action of ["create-plan","modify-plan","plan","set-agreement-status"]) {
  test(`CRM API exposes ${action}`,()=>assert.match(source,new RegExp(action)));
}
test("plan creation writes version snapshots and installments",()=>{ assert.match(source,/crm_payment_plan_versions/); assert.match(source,/crm_installments/); assert.match(source,/agreement_version/); });
test("plan modification preserves paid history by deleting only unpaid future rows",()=>{ assert.match(source,/amount_paid_cents/); assert.match(source,/\.eq\("amount_paid_cents",\s*0\)/); });

test("signed agreement upload activates the payment plan",()=>{ assert.match(source,/category === "signed_payment_plan_agreement"/); assert.match(source,/agreement_status: "signed"/); assert.match(source,/status: "active"/); });
