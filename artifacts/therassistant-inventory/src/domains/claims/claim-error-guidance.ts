export type ClaimCorrectionTarget =
  | "patient_control_number"
  | "payer_claim_number"
  | "service_date_from"
  | "service_date_to"
  | "total_charge_cents"
  | "claim_lines"
  | "diagnoses"
  | "rendering_provider"
  | "payer"
  | "patient"
  | "subscriber";

export type ClaimErrorGuidance = {
  target: ClaimCorrectionTarget;
  actionLabel: string;
  whatIsWrong: string;
  whyItMatters: string;
  correction: string;
};

export type ClaimRejectionIssue = ClaimErrorGuidance & {
  code: string;
  acknowledgementType: string;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getClaimErrorGuidance(message: string): ClaimErrorGuidance | null {
  const value = message.toLowerCase();

  if (value.includes("subscriber") || value.includes("member id") || value.includes("member number")) {
    return {
      target: "subscriber",
      actionLabel: "Open Patient Coverage",
      whatIsWrong: message,
      whyItMatters: "Subscriber and member information must match the payer's enrollment record before the claim can be accepted.",
      correction: "Review the patient's active coverage and correct the member ID, subscriber relationship, or subscriber demographics identified by the rejection.",
    };
  }
  if (value.includes("service date") || value.includes("date of service")) {
    return {
      target: "service_date_from",
      actionLabel: "Correct Service Date",
      whatIsWrong: message,
      whyItMatters: "The payer needs a valid date of service to identify when the billed service occurred and adjudicate the claim.",
      correction: "Enter the correct claim date of service. If the rejection identifies a service line, correct that line's date as well.",
    };
  }
  if (value.includes("claim charge") || value.includes("total charge")) {
    return {
      target: "total_charge_cents",
      actionLabel: "Correct Claim Charge",
      whatIsWrong: message,
      whyItMatters: "A professional claim must contain a valid billed amount before it can be submitted for payment.",
      correction: "Correct the total claim charge and confirm it agrees with the service-line charges.",
    };
  }
  if (value.includes("place of service") || value.includes("pos code")) {
    return {
      target: "claim_lines",
      actionLabel: "Fix Claim Line",
      whatIsWrong: message,
      whyItMatters: "Place of service is reported on the professional service line and can affect coverage and reimbursement.",
      correction: "Correct the place-of-service code on the affected service line.",
    };
  }
  if (value.includes("claim line") && (value.includes("cpt") || value.includes("hcpcs"))) {
    return {
      target: "claim_lines",
      actionLabel: "Fix Claim Line",
      whatIsWrong: message,
      whyItMatters: "CPT/HCPCS identifies the service being billed. Missing or invalid procedure information prevents accurate adjudication.",
      correction: "Correct the procedure code on the affected service line.",
    };
  }
  if (value.includes("modifier") || value.includes("procedure code")) {
    return {
      target: "claim_lines",
      actionLabel: "Fix Claim Line",
      whatIsWrong: message,
      whyItMatters: "Procedure and modifier information identifies the billed service and how it was performed.",
      correction: "Review the affected claim line and correct the CPT/HCPCS code or modifier.",
    };
  }
  if (value.includes("claim line") && value.includes("units")) {
    return {
      target: "claim_lines",
      actionLabel: "Fix Claim Line",
      whatIsWrong: message,
      whyItMatters: "Units tell the payer how much of the service was provided and are required to calculate the billed service correctly.",
      correction: "Enter the correct units for the affected service line.",
    };
  }
  if (value.includes("claim line") && value.includes("charge")) {
    return {
      target: "claim_lines",
      actionLabel: "Fix Claim Line",
      whatIsWrong: message,
      whyItMatters: "Each billed service line requires a valid charge amount for adjudication.",
      correction: "Correct the charge on the affected service line.",
    };
  }
  if (value.includes("diagnosis pointer")) {
    return {
      target: "claim_lines",
      actionLabel: "Correct Diagnosis Pointer",
      whatIsWrong: message,
      whyItMatters: "The diagnosis pointer connects a billed service line to the diagnosis that supports the service.",
      correction: "Review the affected service line and link it to the appropriate diagnosis pointer.",
    };
  }
  if (value.includes("diagnosis") || value.includes("icd-10") || value.includes("icd10")) {
    return {
      target: "diagnoses",
      actionLabel: "Correct Diagnosis",
      whatIsWrong: message,
      whyItMatters: "The claim diagnosis must identify the clinical reason for the billed service.",
      correction: "Select the correct ICD-10-CM diagnosis and confirm the line diagnosis pointer references it.",
    };
  }
  if (value.includes("taxonomy")) {
    return {
      target: "rendering_provider",
      actionLabel: "Correct Rendering Provider",
      whatIsWrong: message,
      whyItMatters: "The rendering provider's taxonomy identifies the provider type and specialty used by the payer to validate the professional claim.",
      correction: "Confirm the rendering provider and taxonomy. If the provider is correct, update the provider record before resubmitting.",
    };
  }
  if (value.includes("npi") || (value.includes("rendering provider") && (value.includes("missing") || value.includes("invalid")))) {
    return {
      target: "rendering_provider",
      actionLabel: "Correct Rendering Provider",
      whatIsWrong: message,
      whyItMatters: "The rendering provider identifies who performed the service and drives NPI, taxonomy, and payer enrollment validation.",
      correction: "Assign the correct rendering provider and verify the provider record contains the correct NPI and taxonomy.",
    };
  }
  if (value.includes("not approved with the payer") || value.includes("not enrolled")) {
    return {
      target: "rendering_provider",
      actionLabel: "Review Provider Enrollment",
      whatIsWrong: message,
      whyItMatters: "A claim can reject or deny when the rendering provider is not enrolled for the payer or product being billed.",
      correction: "Review the rendering provider's payer enrollment before resubmitting. Correct the provider only if the wrong provider was selected.",
    };
  }
  if (value.includes("payer") && (value.includes("missing") || value.includes("invalid") || value.includes(" id"))) {
    return {
      target: "payer",
      actionLabel: "Correct Payer",
      whatIsWrong: message,
      whyItMatters: "The payer determines where the claim is submitted and which billing rules apply.",
      correction: "Assign the correct payer and verify the clearinghouse payer configuration.",
    };
  }
  if (value.includes("patient") && (value.includes("missing") || value.includes("invalid") || value.includes("name") || value.includes("dob") || value.includes("birth"))) {
    return {
      target: "patient",
      actionLabel: "Correct Patient",
      whatIsWrong: message,
      whyItMatters: "The claim must identify the patient receiving the service so the payer can match the member record.",
      correction: "Open the patient record and correct the demographic field identified by the rejection.",
    };
  }
  if (value.includes("control number")) {
    return {
      target: "patient_control_number",
      actionLabel: "Correct Control Number",
      whatIsWrong: message,
      whyItMatters: "The patient control number uniquely identifies the claim within the submitter's workflow.",
      correction: "Correct the patient control number before resubmission.",
    };
  }
  return null;
}

function segmentGuidance(segment: string, message: string): ClaimErrorGuidance | null {
  const value = segment.trim().toUpperCase();
  if (value === "HI") return { target: "diagnoses", actionLabel: "Correct Diagnosis", whatIsWrong: message, whyItMatters: "The HI segment carries diagnosis information on the professional claim.", correction: "Review the claim diagnoses and diagnosis pointers." };
  if (value === "SV1") return { target: "claim_lines", actionLabel: "Fix Claim Line", whatIsWrong: message, whyItMatters: "The SV1 segment carries professional service-line procedure, charge, unit, and diagnosis-pointer information.", correction: "Review the affected service line and correct the value identified by the rejection." };
  if (value === "DTP") return { target: "claim_lines", actionLabel: "Fix Service Date", whatIsWrong: message, whyItMatters: "The DTP segment reports claim or service-line dates.", correction: "Correct the date on the affected service line or claim." };
  if (value === "PRV") return { target: "rendering_provider", actionLabel: "Correct Rendering Provider", whatIsWrong: message, whyItMatters: "The PRV segment reports provider taxonomy information.", correction: "Verify the rendering provider and taxonomy." };
  if (value === "SBR") return { target: "subscriber", actionLabel: "Open Patient Coverage", whatIsWrong: message, whyItMatters: "The SBR segment identifies subscriber relationship and insurance information.", correction: "Correct the patient's subscriber and coverage information." };
  if (value === "CLM") return { target: "patient_control_number", actionLabel: "Review Claim Fields", whatIsWrong: message, whyItMatters: "The CLM segment contains core claim-level information.", correction: "Review the highlighted claim-level fields and correct the value identified by the clearinghouse." };
  return null;
}

export function getClaimRejectionIssue(input: {
  responseCode?: unknown;
  responseMessage?: unknown;
  rawResponse?: unknown;
}): ClaimRejectionIssue | null {
  const message = String(input.responseMessage ?? "").trim() || "Clearinghouse rejected the claim for correction.";
  const code = String(input.responseCode ?? "").trim();
  const raw = objectValue(input.rawResponse);
  const acknowledgementType = String(raw.acknowledgement_type ?? raw.ack_type ?? "").trim();
  const segment = String(raw.segment ?? raw.segment_id ?? raw.segment_name ?? raw.ik3_segment_id ?? "").trim();
  const guidance = getClaimErrorGuidance(message) ?? (segment ? segmentGuidance(segment, message) : null);
  if (!guidance) return null;
  return { ...guidance, code, acknowledgementType };
}
