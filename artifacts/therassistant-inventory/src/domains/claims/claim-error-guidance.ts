export type ClaimCorrectionTarget =
  | "patient_control_number"
  | "payer_claim_number"
  | "service_date_from"
  | "service_date_to"
  | "place_of_service_code"
  | "claim_frequency_code"
  | "total_charge_cents"
  | "claim_lines"
  | "diagnoses"
  | "rendering_provider"
  | "payer"
  | "patient";

export type ClaimErrorGuidance = {
  target: ClaimCorrectionTarget;
  actionLabel: string;
  whatIsWrong: string;
  whyItMatters: string;
  correction: string;
};

export function getClaimErrorGuidance(message: string): ClaimErrorGuidance | null {
  const value = message.toLowerCase();
  if (value.includes("service date")) return { target: "service_date_from", actionLabel: "Correct Service Date", whatIsWrong: message, whyItMatters: "The payer needs a valid date of service to identify when the billed service occurred and adjudicate the claim.", correction: "Enter the correct claim date of service. If a line-level date is missing, review Claim Lines as well." };
  if (value.includes("claim charge") || value.includes("total charge")) return { target: "total_charge_cents", actionLabel: "Correct Claim Charge", whatIsWrong: message, whyItMatters: "A professional claim must contain a valid billed amount before it can be submitted for payment.", correction: "Correct the total claim charge and confirm it agrees with the service-line charges." };
  if (value.includes("claim line") && (value.includes("cpt") || value.includes("hcpcs"))) return { target: "claim_lines", actionLabel: "Review Claim Lines", whatIsWrong: message, whyItMatters: "CPT/HCPCS identifies the service being billed. Missing or invalid procedure information prevents accurate adjudication.", correction: "Open Claim Lines and correct the procedure code on the affected service line." };
  if (value.includes("claim line") && value.includes("units")) return { target: "claim_lines", actionLabel: "Review Claim Lines", whatIsWrong: message, whyItMatters: "Units tell the payer how much of the service was provided and are required to calculate the billed service correctly.", correction: "Open Claim Lines and enter the correct units for the affected service line." };
  if (value.includes("claim line") && value.includes("charge")) return { target: "claim_lines", actionLabel: "Review Claim Lines", whatIsWrong: message, whyItMatters: "Each billed service line requires a valid charge amount for adjudication.", correction: "Open Claim Lines and correct the charge on the affected service line." };
  if (value.includes("diagnosis pointer")) return { target: "claim_lines", actionLabel: "Correct Diagnosis Pointer", whatIsWrong: message, whyItMatters: "The diagnosis pointer connects a billed service line to the diagnosis that supports medical necessity.", correction: "Review the affected Claim Line and link it to the appropriate diagnosis." };
  if (value.includes("diagnosis")) return { target: "diagnoses", actionLabel: "Review Diagnoses", whatIsWrong: message, whyItMatters: "At least one diagnosis is needed to explain the clinical reason for the billed service.", correction: "Open Diagnoses and add or correct the diagnosis information supporting the claim." };
  if (value.includes("rendering provider") && value.includes("missing")) return { target: "rendering_provider", actionLabel: "Correct Rendering Provider", whatIsWrong: message, whyItMatters: "The rendering provider identifies who performed the service and drives payer enrollment, NPI, and taxonomy validation.", correction: "Assign the correct rendering provider to the claim." };
  if (value.includes("not approved with the payer")) return { target: "rendering_provider", actionLabel: "Review Provider Enrollment", whatIsWrong: message, whyItMatters: "A claim can deny when the rendering provider is not enrolled or participating for the payer and product being billed.", correction: "Review the rendering provider's payer enrollment before resubmitting the claim. Correct the provider only if the wrong provider was selected." };
  if (value.includes("payer") && value.includes("missing")) return { target: "payer", actionLabel: "Correct Payer", whatIsWrong: message, whyItMatters: "The payer determines where the claim is submitted and which billing rules apply.", correction: "Assign the correct payer for the patient's coverage." };
  if (value.includes("patient") && value.includes("missing")) return { target: "patient", actionLabel: "Correct Patient", whatIsWrong: message, whyItMatters: "The claim must identify the patient receiving the service so eligibility and member information can be matched.", correction: "Assign the correct patient to the claim." };
  if (value.includes("place of service")) return { target: "place_of_service_code", actionLabel: "Correct Place of Service", whatIsWrong: message, whyItMatters: "Place of service tells the payer where the service occurred and can affect coverage, coding, and reimbursement.", correction: "Enter the place-of-service code that accurately reflects where the service was rendered." };
  if (value.includes("frequency")) return { target: "claim_frequency_code", actionLabel: "Correct Claim Frequency", whatIsWrong: message, whyItMatters: "Claim frequency identifies whether the transaction is original, replacement, or void/cancel and affects payer processing.", correction: "Select the appropriate claim frequency for this submission." };
  return null;
}
