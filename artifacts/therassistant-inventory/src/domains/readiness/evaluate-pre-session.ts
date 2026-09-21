import type {
  PreSessionInput,
  PreSessionReadiness,
  ReadinessCheck,
} from "./types";

const blockingEligibility = new Set([
  "inactive",
  "ineligible",
  "coverage_terminated",
  "unable_to_verify",
  "error",
]);

function check(
  code: string,
  label: string,
  status: ReadinessCheck["status"],
  blocking: boolean,
  message: string,
  action?: string,
): ReadinessCheck {
  return { code, label, status, blocking, message, action };
}

function treatmentPlanCheck(input: PreSessionInput): ReadinessCheck {
  const plan = input.treatmentPlan;
  if (!plan) {
    return check(
      "treatment_plan_missing",
      "Treatment Plan",
      "warn",
      false,
      "No current treatment plan is on file. This may be expected for an intake or first visit.",
      "Create or review the treatment plan when clinically appropriate.",
    );
  }

  const status = String(plan.status ?? "draft");
  if (!["active", "signed"].includes(status)) {
    return check(
      "treatment_plan_status",
      "Treatment Plan",
      "warn",
      false,
      `Treatment plan status is ${status.replaceAll("_", " ")}.`,
      "Review the treatment plan status before ongoing treatment.",
    );
  }

  const serviceDate = input.serviceDate ? new Date(`${input.serviceDate}T12:00:00Z`) : null;
  const reviewDue = plan.review_due_date ? new Date(`${plan.review_due_date}T12:00:00Z`) : null;
  if (
    serviceDate &&
    reviewDue &&
    Number.isFinite(serviceDate.getTime()) &&
    Number.isFinite(reviewDue.getTime()) &&
    reviewDue < serviceDate
  ) {
    return check(
      "treatment_plan_review_overdue",
      "Treatment Plan",
      "warn",
      false,
      `Treatment plan review was due ${plan.review_due_date}.`,
      "Review and update the treatment plan.",
    );
  }

  return check(
    "treatment_plan_current",
    "Treatment Plan",
    "pass",
    false,
    plan.review_due_date
      ? `Treatment plan is current through ${plan.review_due_date}.`
      : "Treatment plan is active.",
  );
}

function payerReadinessChecks(input: PreSessionInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  if (!input.policy) {
    checks.push(
      check(
        "insurance_missing",
        "Insurance",
        "warn",
        false,
        "No insurance policy is on file for this patient.",
        "Add or select an insurance policy.",
      ),
    );
  } else {
    checks.push(
      check(
        "insurance_present",
        "Insurance",
        "pass",
        false,
        "Insurance policy is on file.",
      ),
    );
  }

  const eligibilityStatus = input.eligibility?.eligibility_status ?? null;
  if (!eligibilityStatus || eligibilityStatus === "pending") {
    checks.push(
      check(
        "eligibility_pending",
        "Eligibility",
        "warn",
        false,
        "Eligibility has not been confirmed for this service.",
        "Verify eligibility before claim submission.",
      ),
    );
  } else if (blockingEligibility.has(eligibilityStatus)) {
    checks.push(
      check(
        `eligibility_${eligibilityStatus}`,
        "Eligibility",
        "fail",
        false,
        `Coverage status is ${eligibilityStatus.replaceAll("_", " ")}.`,
        "Resolve coverage before billing or claim submission.",
      ),
    );
  } else if (
    input.serviceDate &&
    input.eligibility?.service_date &&
    input.eligibility.service_date !== input.serviceDate
  ) {
    checks.push(
      check(
        "eligibility_other_service_date",
        "Eligibility",
        "warn",
        false,
        `Coverage is active, but the latest verified eligibility applies to ${input.eligibility.service_date}, not the scheduled service date ${input.serviceDate}.`,
        "Reverify eligibility for the scheduled date of service before claim submission.",
      ),
    );
  } else {
    checks.push(
      check(
        "eligibility_active",
        "Eligibility",
        "pass",
        false,
        input.serviceDate
          ? `Coverage is verified for ${input.serviceDate}.`
          : "Coverage is active.",
      ),
    );
  }

  if (input.providerEnrollmentStatus !== "approved") {
    checks.push(
      check(
        "provider_enrollment",
        "Provider Participation",
        "fail",
        false,
        `Provider enrollment is ${
          (input.providerEnrollmentStatus ?? "not confirmed").replaceAll("_", " ")
        } for this payer.`,
        "Route the payer participation issue for credentialing and billing follow-up.",
      ),
    );
  } else {
    checks.push(
      check(
        "provider_enrollment_approved",
        "Provider Participation",
        "pass",
        false,
        "Provider enrollment is approved for this payer.",
      ),
    );
  }

  return checks;
}

export function evaluatePreSession(
  input: PreSessionInput,
): PreSessionReadiness {
  const checks: ReadinessCheck[] = [];

  if (input.billingType === "self_pay") {
    checks.push(
      check(
        "self_pay",
        "Billing Type",
        "pass",
        false,
        "Patient is self-pay. Insurance, eligibility, and payer enrollment checks do not apply.",
      ),
    );
  } else {
    checks.push(...payerReadinessChecks(input));
  }

  checks.push(treatmentPlanCheck(input));

  return {
    ready: !checks.some((item) => item.blocking),
    checks,
  };
}
