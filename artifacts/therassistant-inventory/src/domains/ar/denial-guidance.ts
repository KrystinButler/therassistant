export type DenialResolutionAction =
  | "correct_resubmit"
  | "appeal"
  | "rebill_other_payer"
  | "review_cob"
  | "verify_benefits"
  | "manual_review"
  | "write_off_contract";

export type AppealTemplateKey =
  | "medical_necessity"
  | "timely_filing"
  | "authorization"
  | "bundling"
  | "noncovered"
  | "duplicate"
  | "benefit_limit"
  | "level_of_service"
  | "frequency"
  | "length_of_service"
  | "documentation"
  | "generic";

export type DenialGuidance = {
  action: DenialResolutionAction;
  actionLabel: string;
  title: string;
  summary: string;
  evidence: string[];
  template: AppealTemplateKey;
  requiresRarc: boolean;
  warning?: string;
};

const CONTRACT_CREDENTIALING_CARCS = new Set([
  "147", "170", "171", "172", "206", "207", "208", "242", "243", "279",
]);

export function normalizeCarcCode(input: unknown) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(CO|PR|OA|PI)-/, "");
}

function result(
  action: DenialResolutionAction,
  actionLabel: string,
  title: string,
  summary: string,
  evidence: string[],
  template: AppealTemplateKey = "generic",
  options: Pick<DenialGuidance, "requiresRarc" | "warning"> = { requiresRarc: false },
): DenialGuidance {
  return {
    action,
    actionLabel,
    title,
    summary,
    evidence,
    template,
    requiresRarc: options.requiresRarc,
    ...(options.warning ? { warning: options.warning } : {}),
  };
}

export function getDenialGuidance(input: {
  carcCode?: unknown;
  rarcCode?: unknown;
  category?: unknown;
  reason?: unknown;
}): DenialGuidance {
  const carc = normalizeCarcCode(input.carcCode);
  const rarc = String(input.rarcCode ?? "").trim().toUpperCase();
  const category = String(input.category ?? "").trim().toLowerCase();

  if (["credentialing", "contracting"].includes(category) || CONTRACT_CREDENTIALING_CARCS.has(carc)) {
    return result(
      "write_off_contract",
      "Contract / credentialing disposition",
      "Contract or credentialing denial",
      "Route this denial to the configured contract/credentialing disposition rather than routine clinical appeal work.",
      ["Provider enrollment or roster status", "Effective date", "Payer contract or participation record", "ERA/EOB"],
    );
  }

  switch (carc) {
    case "4":
      return result("correct_resubmit", "Correct & resubmit", "Modifier inconsistency", "Compare the modifier on the submitted claim to the documented service and payer billing requirements before correcting the claim.", ["Original 837/claim image", "ERA/EOB", "Clinical note", "Payer modifier policy"]);
    case "5":
      return result("correct_resubmit", "Correct & resubmit", "Place-of-service inconsistency", "Validate the service location and telehealth modality, then correct the place of service or related claim data when appropriate.", ["Original 837/claim image", "ERA/EOB", "Clinical note", "Telehealth/location documentation"]);
    case "16": {
      const warning = rarc ? undefined : "CARC 16 is incomplete without the associated RARC. Obtain the RARC before final routing; do not guess which claim element is missing or invalid.";
      return result("correct_resubmit", "Read RARC, then correct", "Missing or invalid claim information", rarc ? `Use RARC ${rarc} to identify the specific missing or invalid claim element before correcting or appealing.` : "The remark code identifies the specific missing or invalid information.", ["ERA/EOB with RARC", "Original 837/claim image", "Corrected source data"], "generic", { requiresRarc: true, warning });
    }
    case "18":
      return result("manual_review", "Investigate duplicate", "Duplicate claim", "Compare the denied claim to prior adjudicated claims. Appeal only when the service is separately reportable or the payer incorrectly identified it as a duplicate.", ["Claim history", "ERA/EOB", "Service dates/times", "Rendering provider", "Clinical note"], "duplicate");
    case "22":
      return result("review_cob", "Review COB", "Coordination of benefits", "Verify payer order and other coverage before rebilling or appealing.", ["Eligibility/COB response", "Primary payer EOB", "Coverage effective dates", "Member insurance record"]);
    case "26":
    case "27":
      return result("verify_benefits", "Verify eligibility", "Coverage-date denial", "Verify the member's coverage history for the date of service and correct or appeal only after coverage dates are confirmed.", ["Eligibility response for DOS", "Coverage effective/termination dates", "Member ID", "Payer reference number"]);
    case "29":
      return result("appeal", "Appeal with filing proof", "Timely filing", "Use proof of the original timely submission and the complete claim history to support reconsideration.", ["Clearinghouse acceptance", "Original submission date", "Payer acknowledgement", "Prior EOB/ERA", "Claim submission history"], "timely_filing");
    case "45":
      return result("manual_review", "Review contract/allowed amount", "Fee schedule or contractual adjustment", "Compare the allowed amount to the applicable fee schedule or contract before creating an underpayment follow-up.", ["Payer contract", "Fee schedule", "ERA/EOB", "Expected reimbursement calculation"]);
    case "50":
      return result("appeal", "Clinical appeal", "Medical necessity", "Use the signed clinical record and treatment context to support the medical necessity of the behavioral health service.", ["Signed progress note", "Treatment plan", "Assessment/diagnosis", "Authorization if applicable", "ERA/EOB"], "medical_necessity");
    case "95":
      return result("manual_review", "Review plan requirements", "Plan procedures not followed", "Identify the specific plan procedure the payer says was not followed before choosing correction, reconsideration, or appeal.", ["ERA/EOB", "Benefit verification", "Payer policy or correspondence", "Claim history"]);
    case "96": {
      const warning = rarc ? undefined : "CARC 96 requires the associated RARC to identify the noncovered-charge rationale. Obtain the RARC before final routing.";
      return result("verify_benefits", "Verify benefit and RARC", "Noncovered charge", rarc ? `Use RARC ${rarc} and the member's plan terms to determine the actual coverage issue.` : "The associated remark code is needed to determine why the charge was considered noncovered.", ["ERA/EOB with RARC", "Eligibility/benefit response", "Plan coverage language", "Payer policy"], "noncovered", { requiresRarc: true, warning });
    }
    case "97":
      return result("appeal", "Coding review / appeal", "Bundled or included service", "Compare the submitted codes and documentation to the payer's coding policy. For E/M plus psychotherapy add-on services, verify that each service is separately supported.", ["Claim lines and modifiers", "Clinical note", "Psychotherapy time when applicable", "Payer coding/reimbursement policy", "ERA/EOB"], "bundling");
    case "109":
      return result("rebill_other_payer", "Bill correct payer", "Wrong payer", "Verify eligibility and payer order, then submit to the correct payer. Preserve original filing proof in case timely filing becomes an issue.", ["Eligibility response for DOS", "COB information", "Original filing proof", "ERA/EOB"]);
    case "119":
      return result("verify_benefits", "Verify benefit maximum", "Benefit maximum reached", "Confirm the applicable benefit period, accumulated services, and which CPT codes counted toward the maximum before appealing.", ["Benefit verification", "Utilization history", "Plan benefit language", "ERA/EOB"], "benefit_limit");
    case "146":
      return result("correct_resubmit", "Review diagnosis & correct", "Diagnosis/date inconsistency", "Validate that the diagnosis code was valid for the date of service and supported by the record before correcting the claim.", ["Claim diagnosis", "Clinical note", "Diagnosis history", "ERA/EOB"]);
    case "150":
      return result("appeal", "Clinical/coding appeal", "Level of service not supported", "Use the complete record to demonstrate why the reported behavioral health service level was supported.", ["Signed clinical note", "Time/duration when applicable", "Assessment", "Treatment plan", "ERA/EOB"], "level_of_service");
    case "151":
      return result("appeal", "Clinical appeal", "Frequency not supported", "Use the treatment history and clinical record to explain why the frequency of services was appropriate for the patient's needs.", ["Signed progress notes", "Treatment plan", "Visit history", "Clinical assessment", "ERA/EOB"], "frequency");
    case "152":
      return result("appeal", "Clinical appeal", "Length of service not supported", "Use documented psychotherapy time and clinical context to support the reported service duration.", ["Signed progress note", "Documented psychotherapy time", "Treatment plan", "ERA/EOB"], "length_of_service");
    case "197":
    case "198":
    case "210":
      return result("appeal", "Authorization review / appeal", "Authorization-related denial", "Compare the denial to the authorization record and benefit information. Appeal when authorization existed, was not required, or another documented exception applies.", ["Authorization record", "Authorization dates/units", "Eligibility/benefit verification", "Payer reference number", "ERA/EOB"], "authorization");
    case "204":
      return result("verify_benefits", "Verify plan coverage", "Service not covered under current benefit plan", "Review the member's plan coverage for the date of service and identify the specific exclusion or benefit provision before appealing.", ["Eligibility/benefit response", "Plan coverage language", "Payer policy", "ERA/EOB"], "noncovered");
    case "B12":
      return result("appeal", "Documentation review / appeal", "Service not documented", "Confirm that the signed record supports the billed service and submit the requested documentation when appropriate.", ["Signed clinical note", "Treatment plan", "Assessment", "Provider signature/authentication", "ERA/EOB"], "documentation");
  }

  switch (category) {
    case "medical_necessity":
      return result("appeal", "Clinical appeal", "Medical necessity", "Use the signed clinical record and treatment context to support the service.", ["Signed progress note", "Treatment plan", "Assessment/diagnosis", "ERA/EOB"], "medical_necessity");
    case "timely_filing":
      return result("appeal", "Appeal with filing proof", "Timely filing", "Use proof of timely submission and claim history.", ["Clearinghouse acceptance", "Original submission date", "Payer acknowledgement", "Claim history"], "timely_filing");
    case "authorization":
      return result("appeal", "Authorization review / appeal", "Authorization-related denial", "Compare the denial to the authorization and benefit records before appealing.", ["Authorization record", "Eligibility/benefit verification", "ERA/EOB"], "authorization");
    case "documentation":
      return result("appeal", "Documentation review / appeal", "Documentation denial", "Confirm that the signed clinical record supports the billed service.", ["Signed clinical note", "Treatment plan", "ERA/EOB"], "documentation");
    case "duplicate":
      return result("manual_review", "Investigate duplicate", "Duplicate claim", "Compare the denied claim with prior adjudicated claims before appealing.", ["Claim history", "ERA/EOB", "Clinical note"], "duplicate");
    case "coordination_of_benefits":
      return result("review_cob", "Review COB", "Coordination of benefits", "Verify payer order and other coverage before rebilling or appealing.", ["Eligibility/COB response", "Primary EOB", "Coverage dates"]);
    case "benefit_limit":
      return result("verify_benefits", "Verify benefits", "Benefit limitation", "Confirm benefit accumulation and plan language before appealing.", ["Benefit verification", "Utilization history", "Plan language"], "benefit_limit");
  }

  return result(
    "manual_review",
    "Manual review",
    "Denial requires review",
    String(input.reason ?? "").trim() || "Review the CARC/RARC, claim data, payer policy, and available documentation before selecting the next action.",
    ["ERA/EOB", "Claim image/837", "Relevant payer policy", "Supporting clinical or administrative record"],
  );
}
