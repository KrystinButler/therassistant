import type { ReadinessCheck } from "../readiness/types";

type BillingReviewInput = {
  encounter: Record<string, any>;
  note: Record<string, any> | null;
  serviceLines: Array<Record<string, any>>;
  billingPath?: string | null;
  billingType?: string | null;
  appointment?: Record<string, any> | null;
  provider?: Record<string, any> | null;
  providerRecordChecked?: boolean;
  providerEnrollmentStatus?: string | null;
  providerEnrollmentEffectiveDate?: string | null;
  providerEnrollmentTerminationDate?: string | null;
};

/** Advisory CMS psychotherapy intervals; payer policies and the actual documented service control. */
const psychotherapyIntervals: Record<string, { minimum: number; maximum?: number }> = {
  "90832": { minimum: 16, maximum: 37 },
  "90834": { minimum: 38, maximum: 52 },
  "90837": { minimum: 53 },
};
const emPsychotherapyAddons = new Set(["90833", "90836", "90838"]);
const eligibleInteractiveComplexityBase = new Set([
  "90791", "90792", "90832", "90833", "90834", "90836",
  "90837", "90838", "90853",
]);

function check(
  code: string,
  label: string,
  status: ReadinessCheck["status"],
  blocking: boolean,
  message: string,
  action: string,
): ReadinessCheck {
  return { code, label, status, blocking, message, action };
}

function dateOnly(value: unknown): string | null {
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function clockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function documentedSessionMinutes(note: BillingReviewInput["note"]): number | null {
  if (!note) return null;
  const entered = note.duration_minutes;
  if (entered !== null && entered !== undefined && entered !== "") {
    const value = Number(entered);
    if (Number.isFinite(value) && value > 0 && Number.isInteger(value)) return value;
  }
  const start = clockMinutes(note.start_time);
  const end = clockMinutes(note.end_time);
  if (start === null || end === null) return null;
  // Only provider-entered note times; encounter-open or scheduled time is not psychotherapy time.
  const difference = end >= start ? end - start : 1440 + end - start;
  return difference > 0 && difference <= 960 ? difference : null;
}

/** These checks never participate in encounter start or clinical signature requirements. */
export function evaluateServiceProviderGuardrails(input: BillingReviewInput): ReadinessCheck[] {
  const result: ReadinessCheck[] = [];
  const path = input.billingPath || (input.billingType === "self_pay" ? "private_pay" : "insurance_claim");
  const insurance = path === "insurance_claim";
  const codes = input.serviceLines.map((line) => String(line.cpt_hcpcs_code ?? "").trim().toUpperCase()).filter(Boolean);
  const uniqueCodes = new Set(codes);
  const signed = input.note && ["signed", "locked"].includes(String(input.note.note_status ?? ""));
  const duration = documentedSessionMinutes(input.note);

  // A scheduled slot is not proof of actual time spent with the patient.
  if (signed && codes.some((code) => code in psychotherapyIntervals)) {
    if (duration === null) {
      result.push(check(
        "psychotherapy_time_not_documented", "Documented Psychotherapy Time", "warn", false,
        "A time-based psychotherapy code is selected, but total actual minutes or note start/stop times are not recorded in the structured clinical note.",
        "Review signed documentation for actual psychotherapy time. Do not substitute the scheduled appointment length.",
      ));
    } else {
      const expected = [...uniqueCodes].filter((code) => code in psychotherapyIntervals);
      for (const code of expected) {
        const interval = psychotherapyIntervals[code];
        if (duration < interval.minimum || (interval.maximum !== undefined && duration > interval.maximum)) {
          result.push(check(
            "psychotherapy_duration_mismatch_" + code, "Psychotherapy Time / Code Review", "warn", false,
            "The note records " + duration + " minutes while " + code + " has a standard psychotherapy reporting interval of " +
              interval.minimum + (interval.maximum === undefined ? "+ minutes." : "–" + interval.maximum + " minutes."),
            "Verify actual face-to-face psychotherapy time, code selection, documentation, and payer-specific guidance before submission.",
          ));
        }
      }
    }
  }

  if (signed && input.note && input.note.duration_minutes != null && input.note.duration_minutes !== "") {
    const start = clockMinutes(input.note.start_time);
    const end = clockMinutes(input.note.end_time);
    if (start !== null && end !== null) {
      const elapsed = end >= start ? end - start : 1440 + end - start;
      const entered = Number(input.note.duration_minutes);
      if (elapsed > 0 && elapsed <= 960 && Number.isFinite(entered) && Math.abs(elapsed - entered) >= 5) {
        result.push(check(
          "note_duration_internal_conflict", "Clinical Time Reconciliation", "warn", false,
          "Documented duration and note start/stop times differ by at least five minutes.",
          "Review the signed note for a time-entry discrepancy without silently altering clinical documentation.",
        ));
      }
    }
  }

  if (signed && input.note?.cpt_code && codes.length &&
      !uniqueCodes.has(String(input.note.cpt_code).trim().toUpperCase())) {
    result.push(check(
      "note_service_code_mismatch", "Note / Charge Code Review", "warn", false,
      "The note's recorded service code is absent from this encounter's charge lines.",
      "Confirm whether the note code or charge lines require a separately documented billing correction.",
    ));
  }

  if ([...uniqueCodes].some((code) => emPsychotherapyAddons.has(code))) {
    if (!codes.some((code) => /^99[2345]\d{2}$/.test(code))) {
      result.push(check(
        "psychotherapy_addon_em_review", "Psychotherapy Add-on / E&M", "warn", false,
        "A psychotherapy-with-E&M add-on is selected without an E&M service line in this encounter.",
        "Verify the separate E&M service, medical-practitioner eligibility, and separately documented psychotherapy minutes.",
      ));
    }
  }

  if (uniqueCodes.has("90785") && ![...uniqueCodes].some((code) => eligibleInteractiveComplexityBase.has(code))) {
    result.push(check(
      "interactive_complexity_base_review", "Interactive Complexity Code", "warn", false,
      "Interactive complexity 90785 is selected without a compatible base service in this encounter.",
      "Verify the companion service and required supporting documentation.",
    ));
  }

  if (uniqueCodes.has("90840") && !uniqueCodes.has("90839")) {
    result.push(check(
      "crisis_addon_base_review", "Crisis Psychotherapy Add-on", "warn", false,
      "Crisis psychotherapy add-on 90840 is present without 90839 in this encounter.",
      "Confirm the primary crisis service and documented total time.",
    ));
  }
  if (uniqueCodes.has("90839") &&
      codes.some((code) => ["90791", "90792", "90832", "90833", "90834", "90836", "90837", "90838"].includes(code))) {
    result.push(check(
      "crisis_routine_code_overlap", "Crisis / Routine Code Review", "warn", false,
      "Crisis psychotherapy and routine psychotherapy or diagnostic evaluation are recorded together in one encounter.",
      "Verify service separation and payer rules; do not automatically combine these codes.",
    ));
  }

  if (insurance && !input.encounter.provider_id) {
    result.push(check(
      "rendering_provider_missing", "Rendering Provider", "fail", true,
      "An insurance claim requires an identified rendering provider.",
      "Assign and verify the rendering provider before claim creation.",
    ));
  } else if (insurance && input.providerRecordChecked && !input.provider) {
    result.push(check(
      "rendering_provider_record_missing", "Rendering Provider", "fail", true,
      "The encounter's rendering provider does not have an accessible practice record.",
      "Reconcile the provider identity before creating an insurance claim.",
    ));
  }

  if (input.provider && input.encounter.provider_id &&
      String(input.provider.id ?? "") !== String(input.encounter.provider_id)) {
    result.push(check(
      "rendering_provider_record_mismatch", "Rendering Provider", "warn", false,
      "The loaded provider record does not match the provider assigned to the encounter.",
      "Review provider identity and the submitted rendering NPI.",
    ));
  }
  if (input.provider && insurance) {
    const status = String(input.provider.provider_status ?? "");
    if (status && status !== "active") {
      result.push(check(
        "rendering_provider_status_review", "Provider Status", "warn", false,
        "The provider's current practice status is " + status.replaceAll("_", " ") + "; it may not reflect the date of service.",
        "Verify the provider's active credentials and service-date status before billing.",
      ));
    }
    if (!String(input.provider.individual_npi ?? "").trim()) {
      result.push(check(
        "rendering_npi_missing", "Rendering Provider NPI", "warn", false,
        "The provider record does not include an individual NPI.",
        "Verify the appropriate rendering identity and NPI for this claim.",
      ));
    }
  }
  if (signed && input.note?.provider_id && input.encounter.provider_id &&
      String(input.note.provider_id) !== String(input.encounter.provider_id)) {
    result.push(check(
      "note_rendering_provider_mismatch", "Note / Rendering Provider", "warn", false,
      "The note's provider differs from the encounter's rendering provider.",
      "Review the documented rendering service and signer or supervision relationship.",
    ));
  }
  if (input.appointment?.provider_id && input.encounter.provider_id &&
      String(input.appointment.provider_id) !== String(input.encounter.provider_id)) {
    result.push(check(
      "scheduled_rendering_provider_mismatch", "Scheduled / Rendering Provider", "warn", false,
      "The appointment provider differs from the encounter's rendering provider.",
      "Confirm the clinician who actually furnished the service.",
    ));
  }

  const serviceDate = dateOnly(input.note?.service_date) || dateOnly(input.encounter.started_at);
  if (insurance && serviceDate &&
      ["approved", "needs_revalidation"].includes(String(input.providerEnrollmentStatus ?? ""))) {
    const effective = dateOnly(input.providerEnrollmentEffectiveDate);
    const termination = dateOnly(input.providerEnrollmentTerminationDate);
    if ((effective && effective > serviceDate) || (termination && termination < serviceDate)) {
      result.push(check(
        "provider_enrollment_dos_conflict", "Provider Enrollment / Service Date", "fail", true,
        "The recorded payer enrollment period does not cover this encounter's date of service.",
        "Verify an applicable effective enrollment period or documented retroactive approval before claim creation.",
      ));
    }
  }

  if (insurance && codes.some((code) => code === "90792" || emPsychotherapyAddons.has(code))) {
    result.push(check(
      "medical_service_scope_review", "Medical Service / Provider Scope", "warn", false,
      "The selected service may require a qualified medical practitioner and separately documented medical services.",
      "Verify the rendering clinician's professional scope, documentation, and applicable payer billing rules.",
    ));
  }

  return result;
}
