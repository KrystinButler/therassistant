import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../../../supabase/functions/crm-api/index.ts",import.meta.url),"utf8");
const lifecycleMigration=readFileSync(new URL("../../../supabase/migrations/20260921082500_crm_atomic_plan_lifecycle.sql",import.meta.url),"utf8");

for (const action of ["create-plan","modify-plan","plan","set-agreement-status"]) {
  test(`CRM API exposes ${action}`,()=>assert.match(source,new RegExp(action)));
}

test("plan creation delegates atomically and writes versions and installments",()=>{
  assert.match(source,/crm_create_plan_atomic/);
  assert.match(lifecycleMigration,/insert into public\.crm_payment_plan_versions/i);
  assert.match(lifecycleMigration,/insert into public\.crm_installments/i);
  assert.match(lifecycleMigration,/agreement_version/i);
  assert.match(lifecycleMigration,/['"]?draft['"]?/i);
});

test("plan modification preserves paid history and replaces only unpaid future rows atomically",()=>{
  assert.match(source,/crm_modify_plan_atomic/);
  assert.match(lifecycleMigration,/delete from public\.crm_installments[\s\S]*amount_paid_cents\s*=\s*0/i);
  assert.match(lifecycleMigration,/status='draft'/i);
  assert.match(lifecycleMigration,/agreement_status='not_generated'/i);
});

test("signed agreement upload activates the payment plan",()=>{
  assert.match(source,/category === "signed_payment_plan_agreement"/);
  assert.match(source,/agreement_status: "signed"/);
  assert.match(source,/status: "active"/);
});

test("open-plan uniqueness and signed-agreement business rules are enforced",()=>{
  assert.match(lifecycleMigration,/crm_payment_plans_one_open_per_account_idx/);
  assert.match(lifecycleMigration,/status in \('draft','active','defaulted'\)/i);
  assert.doesNotMatch(source,/body\.status === "active"/);
  assert.match(source,/signed agreement must be uploaded/i);
  assert.match(source,/crm_create_plan_atomic/);
  assert.match(source,/crm_modify_plan_atomic/);
});
