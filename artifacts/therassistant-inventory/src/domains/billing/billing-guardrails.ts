import type { ReadinessCheck } from "../readiness/types";

type FundingInput = {
  encounter: Record<string, any>;
  fundingSourceType?: string | null;
  billingPath?: string | null;
  fundingContext?: Record<string, unknown>;
};

const expectedPath: Record<string, string> = {
  insurance: "insurance_claim",
  government_program: "program_invoice_voucher",
  private_pay: "private_pay",
};

/**
 * Financial routing checks operate after (and separately from) clinical signing.
 * They must not infer payer coverage, specialty code validity, or medical necessity.
 */
export function evaluateFundingGuardrails(input: FundingInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const source = input.fundingSourceType ?? String(input.encounter.funding_source_type ?? "");
  const path = input.billingPath ?? String(input.encounter.billing_path ?? "");
  const expected = expectedPath[source];

  if (expected && path && path !== expected) {
    checks.push({
      code: "funding_path_conflict",
      label: "Funding / Billing Path",
      status: "fail",
      blocking: true,
      message: `Funding source ${source.replaceAll("_", " ")} conflicts with selected billing path ${path.replaceAll("_", " ")}.`,
      action: "Reconcile the funding source and billing path before charge routing.",
    });
  }

  const resolvedPath = path || expected || "insurance_claim";
  if (resolvedPath === "insurance_claim" && !input.encounter.payer_id) {
    checks.push({
      code: "insurance_payer_missing",
      label: "Insurance Payer",
      status: "fail",
      blocking: true,
      message: "An insurance billing path has no payer assigned to the encounter.",
      action: "Select and verify the correct payer before insurance claim creation.",
    });
  }

  if (resolvedPath !== "insurance_claim" && input.encounter.payer_id) {
    checks.push({
      code: "noninsurance_payer_retained",
      label: "Funding / Payer Review",
      status: "warn",
      blocking: false,
      message: "A payer remains linked to this encounter, but the selected funding path does not create an insurance claim.",
      action: "Confirm the payer is historical context and review the financially responsible entity.",
    });
  }

  const context = input.fundingContext ?? input.encounter.funding_context ?? {};
  if (
    resolvedPath === "program_invoice_voucher" &&
    !String(context.responsible_entity ?? "").trim()
  ) {
    checks.push({
      code: "program_billing_party_missing",
      label: "Program Billing",
      status: "warn",
      blocking: false,
      message: "No financially responsible program or agency is recorded.",
      action: "Confirm program responsibility, reference, and invoice or voucher instructions.",
    });
  }

  const serviceType = String(input.encounter.service_type ?? "").toLowerCase();
  if (
    resolvedPath === "insurance_claim" &&
    /forensic|court|ketamine|psychedelic/.test(serviceType)
  ) {
    checks.push({
      code: "specialty_claim_review",
      label: "Specialty Billing Review",
      status: "warn",
      blocking: false,
      message: "This encounter is marked as a specialty service; confirm code selection and payer coverage before submission.",
      action: "Review the actual documented service, current code guidance, and applicable payer policy.",
    });
  }

  return checks;
}
