import type { ReadinessCheck } from "../readiness/types";

export type PayerRuleResource = {
  id: string;
  payer_id: string;
  payer_plan_id?: string | null;
  label: string;
  resource_type: string;
  verification_status?: string | null;
  source_url?: string | null;
  reviewed_at?: string | null;
  review_due_at?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  rule_config?: unknown;
};
export type PayerRuleConfig = {
  procedure_code: string;
  max_units?: number;
  required_modifier?: string;
  excluded_pos_codes?: string[];
};
export type PayerRuleContext = {
  billingPath?: string | null;
  billingType?: string | null;
  payerId?: string | null;
  payerPlanId?: string | null;
  serviceDate?: string | null;
  serviceLines: Array<Record<string, any>>;
  payerBillingRules?: PayerRuleResource[];
  today?: string;
};

export function parsePayerRuleConfig(value: unknown): PayerRuleConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const procedure_code = String(obj.procedure_code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,5}$/.test(procedure_code)) return null;
  const required_modifier = obj.required_modifier == null || obj.required_modifier === ""
    ? undefined : String(obj.required_modifier).trim().toUpperCase();
  if (required_modifier !== undefined && !/^[A-Z0-9]{2}$/.test(required_modifier)) return null;
  const max_units = obj.max_units == null ? undefined : Number(obj.max_units);
  if (max_units !== undefined && (!Number.isInteger(max_units) || max_units < 1 || max_units > 10000)) return null;
  const excluded_pos_codes = obj.excluded_pos_codes == null ? undefined : obj.excluded_pos_codes;
  if (excluded_pos_codes !== undefined && (
    !Array.isArray(excluded_pos_codes) ||
    excluded_pos_codes.some(code => typeof code !== "string" || !/^[0-9]{2}$/.test(code))
  )) return null;
  return {
    procedure_code,
    ...(required_modifier ? { required_modifier } : {}),
    ...(max_units === undefined ? {} : { max_units }),
    ...(excluded_pos_codes ? { excluded_pos_codes: excluded_pos_codes as string[] } : {}),
  };
}

function check(code: string, label: string, status: ReadinessCheck["status"], blocking: boolean, message: string): ReadinessCheck {
  return {
    code, label, status, blocking, message,
    action: "Review the applicable payer/plan contract and the linked authoritative source in Payer 360. Update the rule or correct the billing line.",
  };
}

function datePart(value?: string | null) { return String(value ?? "").slice(0, 10); }

/** Only verified, source-linked, currently reviewed rules can hold insurance billing. */
export function evaluatePayerBillingRules(input: PayerRuleContext): ReadinessCheck[] {
  const path = input.billingPath ?? (input.billingType === "self_pay" ? "private_pay" : "insurance_claim");
  if (path !== "insurance_claim" || !input.payerId) return [];
  const checks: ReadinessCheck[] = [];
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const serviceDate = datePart(input.serviceDate);
  const applicable: Array<{ resource: PayerRuleResource; config: PayerRuleConfig; index: number }> = [];
  for (const resource of input.payerBillingRules ?? []) {
    if (resource.resource_type !== "billing_rule" || resource.payer_id !== input.payerId) continue;
    // A plan-specific restriction must never leak onto another plan.
    if (resource.payer_plan_id && !input.payerPlanId) {
      checks.push(check("payer_rule_plan_unknown_" + resource.id, "Payer Rule Scope", "warn", false,
        "A plan-specific billing rule exists but the encounter's exact payer product has not been established."));
      continue;
    }
    if (resource.payer_plan_id && resource.payer_plan_id !== input.payerPlanId) continue;
    const config = parsePayerRuleConfig(resource.rule_config);
    if (!config) {
      checks.push(check("payer_rule_invalid_" + resource.id, "Payer Rule Setup", "warn", false,
        "Payer rule " + resource.label + " has invalid or incomplete configuration; it has not been enforced."));
      continue;
    }
    if (serviceDate && (
      (resource.effective_date && datePart(resource.effective_date) > serviceDate) ||
      (resource.expiration_date && datePart(resource.expiration_date) < serviceDate)
    )) continue;
    const trusted = resource.verification_status === "verified" &&
      Boolean(resource.source_url && resource.reviewed_at && resource.review_due_at) &&
      datePart(resource.reviewed_at) <= today &&
      datePart(resource.review_due_at) >= today;
    const matchedLines = input.serviceLines
      .map((line,index)=>({line,index}))
      .filter(({line}) => String(line.cpt_hcpcs_code ?? "").trim().toUpperCase() === config.procedure_code);
    if (!matchedLines.length) continue;
    if (!trusted) {
      checks.push(check("payer_rule_unverified_" + resource.id, "Payer Rule Review", "warn", false,
        "The rule for " + config.procedure_code + " lacks current verified source/review evidence; its restrictions are advisory only."));
      continue;
    }
    for (const {index} of matchedLines) applicable.push({resource,config,index});
  }
  // When a plan-specific rule and payer-wide rule govern the same line,
  // apply the plan-specific rule rather than enforcing contradictory defaults.
  const planOverrideKeys = new Set(applicable
    .filter(x=>Boolean(x.resource.payer_plan_id))
    .map(x=>x.config.procedure_code+":"+x.index));
  for (const {resource,config,index} of applicable) {
    if (!resource.payer_plan_id && planOverrideKeys.has(config.procedure_code+":"+index)) continue;
    const line = input.serviceLines[index];
    const prefix = "payer_rule_" + resource.id + "_" + index;
    const ruleLabel = resource.label + " (" + config.procedure_code + ")";
    if (config.max_units !== undefined && Number(line.units ?? 0) > config.max_units) {
      checks.push(check(prefix+"_units","Payer Rule: Units","fail",true,
        ruleLabel + " permits at most " + config.max_units + " unit(s); the billing line records " + line.units + "."));
    }
    if (config.required_modifier) {
      const modifiers = [line.modifier1,line.modifier2,line.modifier3,line.modifier4]
        .map(x=>String(x ?? "").trim().toUpperCase());
      if (!modifiers.includes(config.required_modifier)) {
        checks.push(check(prefix+"_modifier","Payer Rule: Modifier","fail",true,
          ruleLabel + " requires modifier " + config.required_modifier + " under the currently verified payer rule."));
      }
    }
    if (config.excluded_pos_codes?.includes(String(line.place_of_service_code ?? "").trim())) {
      checks.push(check(prefix+"_pos","Payer Rule: Place of Service","fail",true,
        ruleLabel + " excludes place of service " + line.place_of_service_code + " under the currently verified payer rule."));
    }
  }
  return checks;
}