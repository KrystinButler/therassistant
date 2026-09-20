import type { ReadinessCheck } from "./types";

export type BillingReadinessInput = {
  encounter: Record<string, any>;
  note: Record<string, any> | null;
  diagnoses: Array<Record<string, any>>;
  serviceLines: Array<Record<string, any>>;
  billingType?: string | null;
  eligibilityStatus?: string | null;
  authorizationRequired: boolean;
  authorizationStatus?: string | null;
  remainingUnits?: number | null;
  providerEnrollmentStatus?: string | null;
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

  if (!input.note || !["signed", "locked"].includes(String(input.note.note_status))) {
    checks.push(result("note_unsigned", "Clinical Note", "fail", true, "The clinical note is not signed.", "Complete and sign the encounter note."));
  } else {
    checks.push(result("note_signed", "Clinical Note", "pass", false, "Clinical documentation is signed."));
  }

  if (!input.diagnoses.length) {
    checks.push(result("diagnosis_missing", "Diagnosis", "fail", true, "No encounter diagnosis is available for billing.", "Add at least one diagnosis."));
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

  if (input.billingType === "self_pay") {
    checks.push(result(
      "self_pay",
      "Patient Responsibility",
      "pass",
      false,
      "Patient is self-pay. The charge will route to patient responsibility instead of payer claim creation.",
    ));
  } else {
    if (!["active", "eligible"].includes(String(input.eligibilityStatus ?? ""))) {
      checks.push(result("eligibility_not_active", "Eligibility", "fail", true, `Eligibility is ${String(input.eligibilityStatus ?? "not verified").replaceAll("_", " ")}.`, "Verify active coverage for the service date."));
    } else {
      checks.push(result("eligibility_active", "Eligibility", "pass", false, "Coverage is active for the service date."));
    }
  
    if (input.authorizationRequired) {
      if (input.authorizationStatus !== "approved") {
        checks.push(result("authorization_not_approved", "Authorization", "fail", true, `Authorization is ${String(input.authorizationStatus ?? "missing").replaceAll("_", " ")}.`, "Resolve the authorization before billing."));
      } else if (input.remainingUnits !== null && input.remainingUnits !== undefined && input.remainingUnits <= 0) {
        checks.push(result("authorization_exhausted", "Authorization", "fail", true, "Authorization has no remaining units.", "Obtain additional authorized units."));
      } else {
        checks.push(result("authorization_approved", "Authorization", "pass", false, "Authorization requirement is satisfied."));
      }
    } else {
      checks.push(result("authorization_not_required", "Authorization", "pass", false, "Authorization is not required."));
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
