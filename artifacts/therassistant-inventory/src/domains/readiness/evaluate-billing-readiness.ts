import type { ReadinessCheck } from "./types";
import { evaluateFundingGuardrails } from "../billing/billing-guardrails";
import { evaluateServiceGuardrails } from "../billing/service-guardrails";
import { evaluatePayerBillingRules, type PayerRuleResource } from "../billing/payer-billing-rules";
import { evaluateCodeCompatibility } from "../billing/code-compatibility";

export type BillingReadinessInput = {
  encounter: Record<string, any>;
  note: Record<string, any> | null;
  diagnoses: Array<Record<string, any>>;
  serviceLines: Array<Record<string, any>>;
  billingType?: string | null;
  fundingSourceType?: string | null;
  fundingSourceSubtype?: string | null;
  billingPath?: string | null;
  fundingContext?: Record<string, unknown>;
  eligibilityStatus?: string | null;
  providerEnrollmentStatus?: string | null;
  provider?: Record<string, any> | null;
  documentedPsychotherapyMinutes?: number | null;
  appointment?: Record<string, any> | null;
  payerId?: string | null;
  payerPlanId?: string | null;
  payerBillingRules?: PayerRuleResource[];
  serviceDate?: string | null;
};

export type BillingReadiness = {
  ready: boolean;
  checks: ReadinessCheck[];
};

function result(
  code: string,
  label: string,
  status: ReadinessCheck["status"],
  blocking: boolean,
  message: string,
  action?: string,
): ReadinessCheck {
  return { code, label, status, blocking, message, action };
}

export function evaluateBillingReadiness(input: BillingReadinessInput): BillingReadiness {
  const checks: ReadinessCheck[] = [];
  const billingPath =
    input.billingPath ||
    (input.billingType === "self_pay" ? "private_pay" : "insurance_claim");
  const insuranceClaim = billingPath === "insurance_claim";
  checks.push(...evaluateFundingGuardrails(input));
  checks.push(...evaluateServiceGuardrails(input));
  checks.push(...evaluatePayerBillingRules(input));
  checks.push(...evaluateCodeCompatibility(input.serviceLines, billingPath));

  if (!input.note || !["signed", "locked"].includes(String(input.note.note_status))) {
    checks.push(result("note_unsigned", "Clinical Note", "fail", true, "The clinical note is not signed.", "Complete and sign the encounter note."));
  } else {
    checks.push(result("note_signed", "Clinical Note", "pass", false, "Clinical documentation is signed."));
  }

  if (!input.diagnoses.length) {
    checks.push(
      insuranceClaim
        ? result("diagnosis_missing", "Diagnosis", "fail", true, "No encounter diagnosis is available for an insurance claim.", "Add at least one diagnosis.")
        : result("diagnosis_not_recorded", "Diagnosis", "warn", false, "No encounter diagnosis is recorded. This is not an insurance-claim blocker for the selected billing path; verify the applicable program or private-pay requirements."),
    );
  } else {
    checks.push(result("diagnosis_present", "Diagnosis", "pass", false, "Encounter diagnosis is available."));
  }

  if (!input.serviceLines.length) {
    checks.push(result("service_line_missing", "Service Line", "fail", true, "No billable service line is documented.", "Add a CPT/HCPCS service line."));
  } else {
    const invalid = input.serviceLines.filter((line) =>
      !String(line.cpt_hcpcs_code ?? "").trim() ||
      Number(line.units ?? 0) <= 0 ||
      Number(line.charge_amount_cents ?? 0) <= 0 ||
      !String(line.place_of_service_code ?? "").trim(),
    );
    checks.push(
      invalid.length
        ? result("service_line_incomplete", "Service Line", "fail", true, `${invalid.length} service line(s) are missing CPT/HCPCS, units, charge, or place of service.`, "Correct the service line before billing.")
        : result("service_line_complete", "Service Line", "pass", false, "Billable service line data is complete."),
    );
  }

  if (billingPath === "private_pay") {
    checks.push(result(
      "self_pay",
      "Private Pay",
      "pass",
      false,
      "This encounter will route to private-pay responsibility instead of payer claim creation.",
    ));
  } else if (billingPath === "program_invoice_voucher") {
    checks.push(result(
      "program_billing",
      "Program Funding",
      "pass",
      false,
      "This encounter will route to the program invoice/voucher queue instead of payer claim creation.",
    ));
  } else {
    if (!["active", "eligible"].includes(String(input.eligibilityStatus ?? ""))) {
      checks.push(result("eligibility_not_active", "Eligibility", "fail", true, `Eligibility is ${String(input.eligibilityStatus ?? "not verified").replaceAll("_", " ")}.`, "Verify active coverage for the service date."));
    } else {
      checks.push(result("eligibility_active", "Eligibility", "pass", false, "Coverage is active for the service date."));
    }
  
    if (input.providerEnrollmentStatus === "needs_revalidation") {
      checks.push(result(
        "provider_revalidation_due",
        "Provider Participation",
        "warn",
        false,
        "Provider enrollment is active but requires revalidation.",
        "Complete payer revalidation before the due date.",
      ));
    } else if (input.providerEnrollmentStatus !== "approved") {
      checks.push(result("provider_enrollment", "Provider Participation", "fail", true, `Provider enrollment is ${String(input.providerEnrollmentStatus ?? "not confirmed").replaceAll("_", " ")}.`, "Resolve provider-payer enrollment before claim creation."));
    } else {
      checks.push(result("provider_enrollment_approved", "Provider Participation", "pass", false, "Provider enrollment is approved."));
    }
  }

  return { ready: !checks.some((check) => check.blocking), checks };
}
