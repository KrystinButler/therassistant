import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

import { buildAgreementModel, renderAgreementPdf } from "../src/domains/crm/agreement-pdf";
import type { CrmAccount, CrmInstallment, CrmPaymentPlan } from "../src/domains/crm/types";

const agreement=readFileSync(new URL("../src/domains/crm/agreement-pdf.ts",import.meta.url),"utf8");
const editor=readFileSync(new URL("../src/domains/crm/PaymentPlanEditor.tsx",import.meta.url),"utf8");

test("agreement includes schedule, missed-payment, modification and signature language",()=>{
  assert.match(agreement,/PAYMENT SCHEDULE/);
  assert.match(agreement,/MISSED PAYMENTS/);
  assert.match(agreement,/MODIFICATIONS/);
  assert.match(agreement,/Customer Signature/);
});

test("agreement requires manual payments rather than recurring authorization",()=>{
  assert.match(agreement,/manually initiated/i);
  assert.match(agreement,/does not authorize automatic debits/i);
  assert.doesNotMatch(agreement,/electronic signature|recurring charge/i);
});

test("agreement renderer produces valid-looking PDF bytes with account content",()=>{
  const account={
    id:"11111111-1111-4111-8111-111111111111",
    account_number:"CRM-TEST",
    customer_name:"Test Customer",
    phone:null,email:null,address_line1:null,address_line2:null,city:null,state:null,postal_code:null,
    original_balance_cents:10000,status:"payment_plan",next_follow_up_at:null,
    created_by:"admin@example.com",created_at:"2026-09-21T00:00:00Z",updated_by:"admin@example.com",updated_at:"2026-09-21T00:00:00Z",
    originalBalanceCents:10000,completedPaymentsCents:0,currentBalanceCents:10000,payments:[],
  } satisfies CrmAccount;
  const plan={
    id:"22222222-2222-4222-8222-222222222222",account_id:account.id,status:"draft",
    balance_at_creation_cents:10000,down_payment_cents:0,remaining_balance_cents:10000,
    frequency:"monthly",first_installment_date:"2026-10-01",installment_cents:6000,
    installment_count:2,final_installment_cents:4000,final_installment_date:"2026-11-01",
    grace_period_days:0,special_terms:"Call before changing a due date.",agreement_status:"generated",agreement_version:1,
    created_by:"admin@example.com",created_at:"2026-09-21T00:00:00Z",updated_by:"admin@example.com",updated_at:"2026-09-21T00:00:00Z",
  } satisfies CrmPaymentPlan;
  const installments=[
    {id:"33333333-3333-4333-8333-333333333333",plan_id:plan.id,sequence_number:1,due_date:"2026-10-01",amount_due_cents:6000,amount_paid_cents:0,status:"upcoming",paid_at:null},
    {id:"44444444-4444-4444-8444-444444444444",plan_id:plan.id,sequence_number:2,due_date:"2026-11-01",amount_due_cents:4000,amount_paid_cents:0,status:"upcoming",paid_at:null},
  ] satisfies CrmInstallment[];
  const model=buildAgreementModel(account,plan,installments);
  const bytes=renderAgreementPdf(model);
  const text=new TextDecoder().decode(bytes);
  assert.equal(text.slice(0,8),"%PDF-1.4");
  assert.match(text,/Test Customer/);
  assert.match(text,/CRM-TEST/);
  assert.match(text,/Installment 1/);
  assert.match(text,/Customer Signature/);
  assert.match(text,/%%EOF/);
});

test("payment plan editor creates and modifies plans",()=>{
  assert.match(editor,/create-plan/);
  assert.match(editor,/modify-plan/);
  assert.match(editor,/weekly/);
  assert.match(editor,/biweekly/);
  assert.match(editor,/monthly/);
});
