import type { ReadinessCheck } from "../readiness/types";

export type ServiceGuardrailInput = {
  encounter: Record<string, any>;
  note: Record<string, any> | null;
  serviceLines: Array<Record<string, any>>;
  billingPath?: string | null;
  billingType?: string | null;
  provider?: Record<string, any> | null;
  documentedPsychotherapyMinutes?: number | null;
  appointment?: Record<string, any> | null;
};

const psychotherapyMinutes: Record<string, { min: number; max?: number }> = {
  "90832": { min: 16, max: 37 },
  "90834": { min: 38, max: 52 },
  "90837": { min: 53 },
  "90833": { min: 16, max: 37 },
  "90836": { min: 38, max: 52 },
  "90838": { min: 53 },
};
const psychotherapyAddOns = new Set(["90833", "90836", "90838"]);

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

function numericMinutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function scheduledMinutes(appointment: Record<string, any> | null | undefined): number | null {
  const start = Date.parse(String(appointment?.starts_at ?? ""));
  const end = Date.parse(String(appointment?.ends_at ?? ""));
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? (end - start) / 60000 : null;
}

function documentedPsychotherapyMinutes(input: ServiceGuardrailInput): number | null {
  // Only an explicit documented psychotherapy duration counts. An appointment
  // slot and the total time of an E/M visit cannot establish psychotherapy time.
  return numericMinutes(input.documentedPsychotherapyMinutes)
    ?? numericMinutes(input.note?.psychotherapy_minutes)
    ?? numericMinutes(input.note?.face_to_face_psychotherapy_minutes)
    ?? numericMinutes(input.encounter.psychotherapy_minutes);
}

export function evaluateServiceGuardrails(input: ServiceGuardrailInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const path = input.billingPath ??
    (input.billingType === "self_pay" ? "private_pay" : "insurance_claim");
  if (path !== "insurance_claim") return checks;

  if (!input.encounter.provider_id) {
    checks.push(check(
      "billing_provider_missing", "Billing Provider", "fail", true,
      "An insurance claim cannot be prepared without an assigned rendering provider.",
      "Assign the rendering provider and verify payer participation before creating a claim.",
    ));
  } else if (input.provider === null) {
    checks.push(check(
      "billing_provider_unverified", "Billing Provider", "warn", false,
      "The selected provider record could not be confirmed in this billing review.",
      "Verify rendering provider identity, NPI, credentials, and applicable payer requirements.",
    ));
  } else if (input.provider && !String(input.provider.npi ?? "").trim()) {
    checks.push(check(
      "billing_provider_npi_missing", "Billing Provider", "warn", false,
      "The rendering provider record has no NPI available for review.",
      "Verify the applicable billing/rendering NPI before claim submission.",
    ));
  }

  const codes = input.serviceLines.map(line => String(line.cpt_hcpcs_code ?? "").trim());
  const hasEandM = codes.some(code => /^99[0-9]{3}$/.test(code));
  const actualMinutes = documentedPsychotherapyMinutes(input);
  const slotMinutes = scheduledMinutes(input.appointment);

  for (const [i, line] of input.serviceLines.entries()) {
    const code = codes[i];
    const range = psychotherapyMinutes[code];
    if (!range) continue;

    if (psychotherapyAddOns.has(code) && !hasEandM) {
      checks.push(check(
        `psychotherapy_em_missing_${i}`, "Psychotherapy / E&M", "fail", true,
        `Code ${code} is a psychotherapy add-on and has no E/M service line in this encounter.`,
        "Review the clinical services performed and correct the base E/M or psychotherapy code before insurance submission.",
      ));
    }
    if (actualMinutes !== null) {
      if (actualMinutes < range.min || (range.max !== undefined && actualMinutes > range.max)) {
        checks.push(check(
          `psychotherapy_duration_conflict_${i}`, "Psychotherapy Duration", "fail", true,
          `Code ${code} does not match the recorded ${actualMinutes} psychotherapy minutes (reference range: ${range.min}${range.max === undefined ? "+" : `–${range.max}`} minutes).`,
          "Review documented face-to-face psychotherapy time, the actual service, and current payer-specific coding requirements.",
        ));
      }
    } else {
      checks.push(check(
        `psychotherapy_duration_unverified_${i}`, "Psychotherapy Duration", "warn", false,
        `Actual psychotherapy minutes were not available for code ${code}; scheduled time cannot verify a time-based code.`,
        "Confirm and document actual psychotherapy time before insurance submission.",
      ));
    }
    if (slotMinutes !== null && actualMinutes !== null && actualMinutes > slotMinutes) {
      checks.push(check(
        `psychotherapy_exceeds_schedule_${i}`, "Psychotherapy / Schedule", "warn", false,
        "Documented psychotherapy minutes exceed the scheduled appointment window.",
        "Verify actual start/stop times or the appointment record; do not substitute scheduled duration for documented time.",
      ));
    }
  }

  return checks;
}
