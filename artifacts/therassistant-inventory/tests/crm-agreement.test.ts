import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

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

test("agreement renderer produces a PDF",()=>{
  assert.match(agreement,/%PDF-1\.4/);
  assert.match(agreement,/renderAgreementPdf/);
});

test("payment plan editor creates and modifies plans",()=>{
  assert.match(editor,/create-plan/);
  assert.match(editor,/modify-plan/);
  assert.match(editor,/weekly/);
  assert.match(editor,/biweekly/);
  assert.match(editor,/monthly/);
});
