import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePayerBillingRules, parsePayerRuleConfig, type PayerRuleResource } from "../src/domains/billing/payer-billing-rules";
import { evaluateBillingReadiness } from "../src/domains/readiness/evaluate-billing-readiness";

const verified: PayerRuleResource = {
  id: "verified-rule", payer_id: "payer", payer_plan_id: "plan-A",
  resource_type: "billing_rule", label: "Synthetic plan rule",
  verification_status: "verified",
  source_url: "https://payer.example.test/source",
  reviewed_at: "2026-09-20", review_due_at: "2026-10-30",
  effective_date: "2026-01-01", expiration_date: "2026-12-31",
  rule_config: { procedure_code: "90834", required_modifier: "95", max_units: 1, excluded_pos_codes: ["11"] },
};
const line = {
  cpt_hcpcs_code: "90834", modifier1: "95", modifier2: null,
  units: 1, charge_amount_cents: 10000, place_of_service_code: "02",
};
const base = {
  billingPath: "insurance_claim", payerId: "payer", payerPlanId: "plan-A",
  serviceDate: "2026-09-23", today: "2026-09-23",
  serviceLines: [line], payerBillingRules: [verified],
};

test("matching verified plan rule accepts compliant billing lines", () => {
  assert.deepEqual(evaluatePayerBillingRules(base), []);
});
test("a source-verified rule holds missing modifier, excess units and excluded POS", () => {
  const checks = evaluatePayerBillingRules({
    ...base, serviceLines: [{ ...line, modifier1: null, units: 2, place_of_service_code: "11" }],
  });
  assert.deepEqual(checks.filter(c=>c.blocking).map(c=>c.code).sort(), [
    "payer_rule_verified-rule_0_modifier", "payer_rule_verified-rule_0_pos", "payer_rule_verified-rule_0_units",
  ]);
});
test("unverified rules warn without holding billing", () => {
  const checks = evaluatePayerBillingRules({ ...base, payerBillingRules: [{ ...verified, verification_status: "unverified" }], serviceLines: [{ ...line, units: 3 }] });
  assert.equal(checks.some(c=>c.blocking),false);
  assert.equal(checks[0].status,"warn");
});
test("missing source or overdue review disables automatic holds", () => {
  for (const changed of [{source_url:null},{review_due_at:"2026-09-22"},{reviewed_at:null}]) {
    const checks = evaluatePayerBillingRules({ ...base, payerBillingRules: [{...verified,...changed}], serviceLines: [{...line,units:3}] });
    assert.equal(checks.some(c=>c.blocking),false);
    assert.ok(checks.some(c=>c.code.startsWith("payer_rule_unverified_")));
  }
});
test("a rule for another plan is never applied", () => {
  assert.deepEqual(evaluatePayerBillingRules({ ...base, payerPlanId:"plan-B", serviceLines:[{...line,units:3}] }), []);
});
test("unknown plan warns rather than applying a plan-specific rule", () => {
  const checks = evaluatePayerBillingRules({ ...base, payerPlanId:null, serviceLines:[{...line,units:3}] });
  assert.equal(checks.some(c=>c.blocking),false);
  assert.ok(checks.some(c=>c.code==="payer_rule_plan_unknown_verified-rule"));
});
test("expired and future-effective rules do not apply to other service dates", () => {
  for (const date of ["2025-12-31","2027-01-01"]) {
    assert.deepEqual(evaluatePayerBillingRules({ ...base, serviceDate:date, serviceLines:[{...line,units:3}] }), []);
  }
});
test("verified plan-specific code overrides the same payer-wide code", () => {
  const payerWide = { ...verified, id:"payer-wide", payer_plan_id:null, rule_config:{procedure_code:"90834",max_units:3} };
  const checks = evaluatePayerBillingRules({
    ...base, payerBillingRules:[payerWide,verified], serviceLines:[{...line,units:2}],
  });
  assert.equal(checks.filter(c=>c.blocking).length,1);
  assert.equal(checks.find(c=>c.blocking)?.code,"payer_rule_verified-rule_0_units");
});
test("invalid JSON rule configuration never holds billing", () => {
  assert.equal(parsePayerRuleConfig({procedure_code:"90834",max_units:"many"}),null);
  assert.equal(parsePayerRuleConfig({procedure_code:"90834",excluded_pos_codes:["wrong"]}),null);
  const checks=evaluatePayerBillingRules({ ...base, payerBillingRules:[{...verified,rule_config:{procedure_code:"90834",max_units:-1}}] });
  assert.ok(checks.some(c=>c.status==="warn"&&!c.blocking));
});
test("unknown or out-of-scope CPT cannot be interpreted as noncovered", () => {
  assert.deepEqual(evaluatePayerBillingRules({ ...base, serviceLines:[{...line,cpt_hcpcs_code:"H0004"}] }),[]);
});
test("program-funded services skip insurance-only payer rules", () => {
  assert.deepEqual(evaluatePayerBillingRules({ ...base, billingPath:"program_invoice_voucher", serviceLines:[{...line,units:3}] }),[]);
});
test("payer guardrail integrates with claim readiness without changing note signing", () => {
  const result = evaluateBillingReadiness({
    encounter:{id:"enc",payer_id:"payer",provider_id:"provider"},
    note:{note_status:"signed",psychotherapy_minutes:45},
    diagnoses:[{diagnosis_code:"F41.1"}],
    serviceLines:[{...line,modifier1:null,id:"line"}],
    eligibilityStatus:"active",providerEnrollmentStatus:"approved",
    billingPath:"insurance_claim",payerId:"payer",payerPlanId:"plan-A",
    serviceDate:"2026-09-23",payerBillingRules:[verified],
  });
  assert.equal(result.ready,false);
  assert.ok(result.checks.some(c=>c.code==="payer_rule_verified-rule_0_modifier"&&c.blocking));
  assert.ok(result.checks.some(c=>c.code==="note_signed"&&c.status==="pass"));
});
test("same-code, same-modifier duplicate billing lines get review, not automatic denial", () => {
  const result=evaluateBillingReadiness({
    encounter:{id:"enc",payer_id:"payer",provider_id:"provider"},
    note:{note_status:"signed",psychotherapy_minutes:45},
    diagnoses:[{diagnosis_code:"F41.1"}],
    serviceLines:[{...line,id:"one"},{...line,id:"two"}],
    eligibilityStatus:"active",providerEnrollmentStatus:"approved",
  });
  assert.ok(result.checks.some(c=>c.code==="duplicate_service_line_review"&&c.status==="warn"&&!c.blocking));
});
