import type { ReadinessCheck } from "../readiness/types";

type ServiceLine = Record<string, any>;

function advisory(code: string, message: string): ReadinessCheck {
  return {
    code,
    label: "Procedure Code Compatibility",
    status: "warn",
    blocking: false,
    message,
    action: "Verify distinct documented services, applicable coding edits and payer policy before claim submission.",
  };
}

/**
 * Structural add-on prerequisites are held. Other potentially conflicting
 * combinations remain advisory because separate distinct encounters, modifiers,
 * and payer edits can change the billing outcome.
 */
export function evaluateCodeCompatibility(
  serviceLines: ServiceLine[],
  billingPath = "insurance_claim",
): ReadinessCheck[] {
  if (billingPath !== "insurance_claim") return [];
  const codes = serviceLines.map(line => String(line.cpt_hcpcs_code ?? "").trim().toUpperCase());
  const present = new Set(codes);
  const checks: ReadinessCheck[] = [];
  if (present.has("90840") && !present.has("90839")) {
    checks.push({
      code: "crisis_add_on_missing_base",
      label: "Crisis Psychotherapy Add-On",
      status: "fail",
      blocking: true,
      message: "Crisis psychotherapy add-on 90840 requires a corresponding base 90839 service.",
      action: "Review the crisis service documentation and correct the base/add-on pairing before routing to insurance billing.",
    });
  }

  const standard = ["90832", "90834", "90837"].filter(code => present.has(code));
  if (standard.length > 1) {
    checks.push(advisory(
      "overlapping_individual_psychotherapy",
      "Multiple individual psychotherapy time-based codes are present in one encounter (" +
        standard.join(", ") + "). Verify separate distinct services and intervals before submission.",
    ));
  }

  if (present.has("90791") && present.has("90792")) {
    checks.push(advisory(
      "duplicate_diagnostic_evaluations",
      "Both psychiatric diagnostic evaluation codes 90791 and 90792 appear in one encounter.",
    ));
  }

  if ((present.has("90791") || present.has("90792")) &&
      codes.some(code => /^908(3[2-9]|40|4[67]|53)$/.test(code))) {
    checks.push(advisory(
      "diagnostic_psychotherapy_overlap",
      "Diagnostic evaluation and psychotherapy services appear in one encounter; confirm separate billable services and current payer edits.",
    ));
  }

  if ((present.has("90839") || present.has("90840")) &&
      codes.some(code => /^(90785|90791|90792|9083[2-8]|9084[67]|90853)$/.test(code))) {
    checks.push(advisory(
      "crisis_code_overlap",
      "Crisis psychotherapy appears alongside other psychiatric/psychotherapy codes; confirm separate services and applicable payer combination rules.",
    ));
  }
  return checks;
}
