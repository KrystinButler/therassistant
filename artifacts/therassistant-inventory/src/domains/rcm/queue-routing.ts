import { getClaimErrorGuidance } from "../claims/claim-error-guidance";

export type OperationalHome =
  | "charges"
  | "rejections"
  | "claims"
  | "denials"
  | "payments"
  | null;

export type ClaimsTab =
  | "no_response"
  | "deferred"
  | "0_30"
  | "31_60"
  | "61_90"
  | "91_120"
  | "120_plus";

export type RejectionCategory =
  | "patient"
  | "subscriber"
  | "provider"
  | "payer"
  | "diagnosis"
  | "procedure_modifier"
  | "authorization"
  | "claim_format"
  | "other";

export type DenialTab = "corrected_claims" | "appeals" | "deferred" | string;

export function getOperationalHome(input: {
  claimStatus: unknown;
  latestResponseStatus?: unknown;
  hasActiveDenial: boolean;
  openBalanceCents: number;
}): OperationalHome {
  const status = String(input.claimStatus ?? "");
  const latestResponseStatus = String(input.latestResponseStatus ?? "").toLowerCase();

  if (input.hasActiveDenial || ["denied", "appealed"].includes(status)) {
    return "denials";
  }
  if (
    ["validation_failed", "rejected", "corrected"].includes(status)
    || (latestResponseStatus === "rejected" && ["submitted", "batched"].includes(status))
  ) {
    return "rejections";
  }
  if (["ready_for_validation", "ready_for_batch", "batched"].includes(status)) {
    return "charges";
  }
  if (["paid", "partially_paid"].includes(status) && input.openBalanceCents <= 0) {
    return "payments";
  }
  if (["submitted", "accepted", "partially_paid"].includes(status) && input.openBalanceCents > 0) {
    return "claims";
  }
  return null;
}

export function getClaimsTab(
  input: {
    deferred: boolean;
    submittedAt?: string | null;
    serviceDate?: string | null;
    hasPayerResponse: boolean;
  },
  today = new Date(),
): ClaimsTab {
  if (input.deferred) return "deferred";
  if (!input.hasPayerResponse) return "no_response";

  const sourceDate = input.submittedAt || input.serviceDate;
  if (!sourceDate) return "0_30";

  const date = new Date(`${sourceDate.slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));

  if (ageDays <= 30) return "0_30";
  if (ageDays <= 60) return "31_60";
  if (ageDays <= 90) return "61_90";
  if (ageDays <= 120) return "91_120";
  return "120_plus";
}

const targetCategories: Partial<Record<string, RejectionCategory>> = {
  patient: "patient",
  patient_control_number: "patient",
  rendering_provider: "provider",
  payer: "payer",
  diagnoses: "diagnosis",
  claim_lines: "procedure_modifier",
  service_date_from: "claim_format",
  service_date_to: "claim_format",
  place_of_service_code: "claim_format",
  claim_frequency_code: "claim_format",
  total_charge_cents: "claim_format",
  payer_claim_number: "claim_format",
};

function keywordCategory(message: string): RejectionCategory {
  const value = message.toLowerCase();
  if (value.includes("subscriber") || value.includes("member")) return "subscriber";
  if (value.includes("authorization") || value.includes("prior auth")) return "authorization";
  if (value.includes("payer")) return "payer";
  if (value.includes("provider") || value.includes("npi") || value.includes("taxonomy")) return "provider";
  if (value.includes("diagnosis")) return "diagnosis";
  if (value.includes("cpt") || value.includes("hcpcs") || value.includes("modifier") || value.includes("procedure")) {
    return "procedure_modifier";
  }
  if (value.includes("patient")) return "patient";
  if (
    value.includes("date") ||
    value.includes("frequency") ||
    value.includes("place of service") ||
    value.includes("charge") ||
    value.includes("control number")
  ) {
    return "claim_format";
  }
  return "other";
}

export function getRejectionCategories(messages: string[]): RejectionCategory[] {
  const categories: RejectionCategory[] = [];

  for (const message of messages) {
    const guidance = getClaimErrorGuidance(message);
    const category =
      (guidance ? targetCategories[guidance.target] : undefined) ?? keywordCategory(message);
    if (!categories.includes(category)) categories.push(category);
  }

  return categories.length ? categories : ["other"];
}

export function getDenialTab(input: {
  deferred: boolean;
  appealActive: boolean;
  correctedClaim: boolean;
  denialCategory: unknown;
}): DenialTab {
  if (input.deferred) return "deferred";
  if (input.appealActive) return "appeals";
  if (input.correctedClaim) return "corrected_claims";

  const category = String(input.denialCategory ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return category || "other";
}
