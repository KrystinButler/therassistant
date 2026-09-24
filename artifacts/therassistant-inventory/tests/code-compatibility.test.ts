import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCodeCompatibility } from "../src/domains/billing/code-compatibility";
const line=(code:string)=>({cpt_hcpcs_code:code});
test("crisis psychotherapy add-on 90840 needs its 90839 base on an insurance claim",()=>{
 const checks=evaluateCodeCompatibility([line("90840")]);
 assert.ok(checks.some(c=>c.code==="crisis_add_on_missing_base"&&c.blocking));
 assert.equal(evaluateCodeCompatibility([line("90839"),line("90840")]).some(c=>c.code==="crisis_add_on_missing_base"),false);
});
test("incompatible-looking diagnostic or overlapping psychotherapy pairs prompt review, not automatic denial",()=>{
 const checks=evaluateCodeCompatibility([line("90791"),line("90792"),line("90832"),line("90837")]);
 assert.ok(checks.some(c=>c.code==="duplicate_diagnostic_evaluations"&&c.status==="warn"&&!c.blocking));
 assert.ok(checks.some(c=>c.code==="overlapping_individual_psychotherapy"&&c.status==="warn"&&!c.blocking));
});
test("insurance code constraints never gate private pay or program funding",()=>{
 for(const path of ["private_pay","program_invoice_voucher"]) assert.deepEqual(evaluateCodeCompatibility([line("90840")],path),[]);
});
