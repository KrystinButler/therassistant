import type { ReadinessCheck } from "../readiness/types";

type Row = Record<string, any>;
export type PayerRulesInput = {
  encounter: Row;
  note: Row | null;
  serviceLines: Row[];
  billingPath?: string | null;
  billingType?: string | null;
  payerPlanId?: string | null;
  payerRules?: Row[];
  asOfDate?: string | null;
};

type Rule = {
  kind: "require_modifier" | "prohibit_modifier" | "allowed_pos" | "maximum_units";
  procedure_code: string;
  modifier?: string;
  allowed_pos?: string[];
  maximum_units?: number;
};

const validKinds = new Set(["require_modifier", "prohibit_modifier", "allowed_pos", "maximum_units"]);

function warning(code: string, message: string, action: string): ReadinessCheck {
  return { code, label: "Payer-Specific Billing", status: "warn", blocking: false, message, action };
}

function normalizeRule(value: unknown): Rule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Row;
  const kind = String(row.kind ?? "");
  const procedure_code = String(row.procedure_code ?? "").trim().toUpperCase();
  if (!validKinds.has(kind) || !/^[A-Z0-9]{4,7}$/.test(procedure_code)) return null;
  if (kind === "require_modifier" || kind === "prohibit_modifier") {
    const modifier = String(row.modifier ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(modifier)) return null;
    return { kind: kind as Rule["kind"], procedure_code, modifier };
  }
  if (kind === "allowed_pos") {
    const positions = Array.isArray(row.allowed_pos)
      ? [...new Set(row.allowed_pos.map((item: unknown) => String(item).trim()).filter((item: string) => /^\d{2}$/.test(item)))]
      : [];
    if (!positions.length || positions.length > 15) return null;
    return { kind, procedure_code, allowed_pos: positions };
  }
  if (!Number.isInteger(row.maximum_units) || row.maximum_units < 1 || row.maximum_units > 100) return null;
  return { kind: "maximum_units", procedure_code, maximum_units: row.maximum_units };
}

function isoDay(value: unknown): string | null {
  const day = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d\d-\d\d$/.test(day) ? day : null;
}

function violation(rule: Rule, lines: Row[]): string | null {
  if (!lines.length) return null;
  if (rule.kind === "require_modifier") {
    const missing = lines.filter(line =>
      ![line.modifier1, line.modifier2, line.modifier3, line.modifier4]
        .some(modifier => String(modifier ?? "").toUpperCase() === rule.modifier));
    return missing.length ? "requires modifier " + rule.modifier + " on " + missing.length + " line(s)" : null;
  }
  if (rule.kind === "prohibit_modifier") {
    const found = lines.some(line =>
      [line.modifier1, line.modifier2, line.modifier3, line.modifier4]
        .some(modifier => String(modifier ?? "").toUpperCase() === rule.modifier));
    return found ? "lists modifier " + rule.modifier + " as prohibited" : null;
  }
  if (rule.kind === "allowed_pos") {
    const unexpected = lines
      .map(line => String(line.place_of_service_code ?? "").trim())
      .filter(pos => pos && !rule.allowed_pos?.includes(pos));
    return unexpected.length ? "lists place of service " + [...new Set(unexpected)].join(", ") +
      " outside the configured POS set (" + rule.allowed_pos?.join(", ") + ")" : null;
  }
  const units = lines.reduce((sum, line) => sum + Number(line.units ?? 0), 0);
  return Number.isFinite(units) && units > Number(rule.maximum_units)
    ? "limits the total units to " + rule.maximum_units + " (recorded " + units + ")" : null;
}

function sourceIsCurrent(resource: Row, asOf: string, serviceDate: string | null): boolean {
  return resource.verification_status === "verified" &&
    /^https:\/\//i.test(String(resource.source_url ?? "")) &&
    Boolean(isoDay(resource.reviewed_at)) &&
    Boolean(isoDay(resource.review_due_at)) &&
    Boolean(isoDay(resource.effective_date)) &&
    String(resource.reviewed_at).slice(0, 10) <= asOf &&
    String(resource.review_due_at).slice(0, 10) >= asOf &&
    Boolean(serviceDate);
}

/**
 * Staff-configured payer rules are enforced only with verified, traceable,
 * current source evidence and an applicable service date/plan. An unverified,
 * stale, ambiguous or unsourced rule is an advisory, never an automatic hold.
 */
export function evaluatePayerBillingRules(input: PayerRulesInput): ReadinessCheck[] {
  const path = input.billingPath ?? (input.billingType === "self_pay" ? "private_pay" : "insurance_claim");
  if (path !== "insurance_claim" || !Array.isArray(input.payerRules)) return [];

  const payerId = String(input.encounter.payer_id ?? "");
  const planId = String(input.payerPlanId ?? "");
  const serviceDate = isoDay(input.note?.service_date) ?? isoDay(input.encounter.started_at);
  const asOf = isoDay(input.asOfDate) ?? new Date().toISOString().slice(0, 10);
  const checks: ReadinessCheck[] = [];

  const relevant = input.payerRules.filter(row => {
    if (row.resource_type !== "billing_rule" || String(row.payer_id ?? "") !== payerId || !payerId) return false;
    if (row.payer_plan_id && String(row.payer_plan_id) !== planId) return false;
    if (serviceDate && row.effective_date && String(row.effective_date).slice(0, 10) > serviceDate) return false;
    if (serviceDate && row.expiration_date && String(row.expiration_date).slice(0, 10) < serviceDate) return false;
    return true;
  });

  if (!relevant.length) {
    return [warning(
      "payer_rules_not_configured",
      "No applicable payer-specific billing rules have been configured or confirmed for this payer and plan.",
      "Use the current payer policy and contract when scrubbing the claim; add verified, dated rules in the payer profile.",
    )];
  }

  const byKey = new Map<string, Array<{ resource: Row; rule: Rule }>>();
  for (const resource of relevant) {
    const rule = normalizeRule(resource.billing_rule);
    if (!rule) {
      checks.push(warning(
        "payer_rule_invalid_" + String(resource.id ?? checks.length),
        "Payer rule " + String(resource.label ?? "") + " has incomplete configuration; it cannot hold a claim.",
        "Correct the rule configuration and verify its source in the payer profile.",
      ));
      continue;
    }
    const key = rule.procedure_code + "|" + rule.kind;
    const group = byKey.get(key) ?? [];
    group.push({ resource, rule });
    byKey.set(key, group);
  }

  for (const [key, group] of byKey) {
    const lines = input.serviceLines.filter(
      line => String(line.cpt_hcpcs_code ?? "").trim().toUpperCase() === group[0].rule.procedure_code);
    if (!lines.length) continue;

    // A plan-specific rule supersedes the same payer-wide kind/code. Competing
    // rules at the same specificity cannot safely impose an automatic hold.
    const scope = group.some(item => Boolean(item.resource.payer_plan_id))
      ? group.filter(item => Boolean(item.resource.payer_plan_id))
      : group;
    const distinct = new Set(scope.map(item => JSON.stringify(item.rule)));
    if (distinct.size > 1) {
      checks.push(warning(
        "payer_rule_conflict_" + key.replace("|", "_"),
        "Conflicting configured payer rules exist for code " + group[0].rule.procedure_code + ".",
        "Reconcile the competing sources, plan scope and review dates before enforcing a billing rule.",
      ));
      continue;
    }
    const selected = scope.sort((a, b) => String(b.resource.reviewed_at ?? "").localeCompare(String(a.resource.reviewed_at ?? "")))[0];
    const issue = violation(selected.rule, lines);
    if (!issue) continue;
    const verified = sourceIsCurrent(selected.resource, asOf, serviceDate);
    const label = String(selected.resource.label ?? "Payer rule");
    const message = "Code " + selected.rule.procedure_code + ": " + label + " " + issue + "." +
      (verified ? "" : " This rule lacks current, complete source verification.");
    const action = verified
      ? "Review the charge against the staff-verified payer policy (" + String(selected.resource.source_url) +
        ") before claim creation."
      : "Verify plan applicability, the authoritative payer policy, effective date and next review date before relying on this rule.";
    checks.push({
      code: "payer_rule_" + (verified ? "hold_" : "review_") + key.replace("|", "_"),
      label: "Payer-Specific Billing",
      status: verified ? "fail" : "warn",
      blocking: verified,
      message,
      action,
    });
  }
  return checks;
}
