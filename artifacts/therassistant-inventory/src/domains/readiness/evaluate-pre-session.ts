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

export function evaluatePreSession(
  input: PreSessionInput,
): PreSessionReadiness {
  const checks: ReadinessCheck[] = [];

  if (!input.policy) {
    checks.push(
      check(
        "insurance_missing",
        "Insurance",
        "fail",
        true,
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
        true,
        "Eligibility has not been confirmed for this service.",
        "Run eligibility before starting the encounter.",
      ),
    );
  } else if (blockingEligibility.has(eligibilityStatus)) {
    checks.push(
      check(
        `eligibility_${eligibilityStatus}`,
        "Eligibility",
        "fail",
        true,
        `Coverage status is ${eligibilityStatus.replaceAll("_", " ")}.`,
        "Resolve coverage before starting the encounter.",
      ),
    );
  } else {
    checks.push(
      check(
        "eligibility_active",
        "Eligibility",
        "pass",
        false,
        "Coverage is active for the service date.",
      ),
    );
  }

  if (!input.authorizationRequired) {
    checks.push(
      check(
        "authorization_not_required",
        "Authorization",
        "pass",
        false,
        "Authorization is not required for this service.",
      ),
    );
  } else if (!input.authorization) {
    checks.push(
      check(
        "authorization_missing",
        "Authorization",
        "fail",
        true,
        "This service requires authorization, but no authorization is on file.",
        "Add or obtain authorization before the encounter.",
      ),
    );
  } else if (input.authorization.status !== "approved") {
    checks.push(
      check(
        `authorization_${input.authorization.status ?? "unknown"}`,
        "Authorization",
        "fail",
        true,
        `Authorization status is ${(input.authorization.status ?? "unknown").replaceAll("_", " ")}.`,
        "Resolve the authorization status before the encounter.",
      ),
    );
  } else {
    const remaining = Number(input.authorization.remaining_units ?? 1);
    if (Number.isFinite(remaining) && remaining <= 0) {
      checks.push(
        check(
          "authorization_exhausted",
          "Authorization",
          "fail",
          true,
          "The authorization has no remaining units.",
          "Obtain additional authorized units before the encounter.",
        ),
      );
    } else {
      checks.push(
        check(
          "authorization_approved",
          "Authorization",
          "pass",
          false,
          "Authorization is approved with units available.",
        ),
      );
    }
  }

  if (input.providerEnrollmentStatus !== "approved") {
    checks.push(
      check(
        "provider_enrollment",
        "Provider Participation",
        "fail",
        true,
        `Provider enrollment is ${
          (input.providerEnrollmentStatus ?? "not confirmed").replaceAll("_", " ")
        } for this payer.`,
        "Resolve provider enrollment or select an eligible provider.",
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

  checks.push(treatmentPlanCheck(input));

  return {
    ready: !checks.some((item) => item.blocking),
    checks,
  };
}
