import { getDenialGuidance } from "./denial-guidance";

export type AppealTemplateContext = {
  patientName?: string;
  dateOfBirth?: string;
  memberId?: string;
  payerName?: string;
  claimNumber?: string;
  payerClaimNumber?: string;
  serviceDate?: string;
  cptCodes?: string[];
  diagnosisCodes?: string[];
  renderingProviderName?: string;
  renderingProviderCredentials?: string;
  renderingProviderNpi?: string;
  billingProviderName?: string;
  billingProviderNpi?: string;
  carcCode?: string;
  rarcCode?: string;
  denialReason?: string;
  denialCategory?: string;
  deniedAmountCents?: number;
  submittedAt?: string;
  authorizationNumber?: string;
  authorizationStartDate?: string;
  authorizationEndDate?: string;
  clinicalDurationMinutes?: number | null;
  supportingFacts?: string;
};

function present(value: unknown) {
  const text = String(value ?? "").trim();
  return text && text !== "—" ? text : "";
}

function join(values?: string[]) {
  return (values ?? []).map(present).filter(Boolean).join(", ");
}

function dollars(cents?: number) {
  if (!Number.isFinite(cents)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

function headerLine(label: string, value: unknown) {
  const text = present(value);
  return text ? `${label}: ${text}` : "";
}

function authorizationFacts(context: AppealTemplateContext) {
  const details = [
    headerLine("Authorization number", context.authorizationNumber),
    headerLine("Authorization effective date", context.authorizationStartDate),
    headerLine("Authorization end date", context.authorizationEndDate),
  ].filter(Boolean);
  return details.length ? `\n\nAuthorization information available in the record:\n${details.join("\n")}` : "";
}

function bodyFor(context: AppealTemplateContext) {
  const guidance = getDenialGuidance({
    carcCode: context.carcCode,
    rarcCode: context.rarcCode,
    category: context.denialCategory,
    reason: context.denialReason,
  });
  const cpts = join(context.cptCodes) || "the billed behavioral health service";
  const duration = context.clinicalDurationMinutes != null && Number.isFinite(context.clinicalDurationMinutes)
    ? ` The clinical record documents ${context.clinicalDurationMinutes} minutes for the service.`
    : "";

  switch (guidance.template) {
    case "medical_necessity":
      return `We are requesting reconsideration of the medical-necessity denial for ${cpts}. The treating clinician determined that the service was clinically appropriate based on the patient's documented presentation, symptoms and/or functional impairment, treatment goals, interventions, response to treatment, and continuing behavioral health needs. The enclosed clinical record should be reviewed in its entirety. Please reverse the denial and reprocess the claim when the submitted documentation satisfies the member's applicable coverage criteria.`;
    case "timely_filing":
      return `We are appealing the timely-filing denial for this claim. The claim history and supporting transmission records document the provider's submission activity.${context.submittedAt ? ` The recorded submission date is ${context.submittedAt}.` : ""} Please review the attached clearinghouse or payer acknowledgement and original claim history. If the original claim was received within the applicable filing period, please override the timely-filing denial and reprocess the claim.`;
    case "authorization":
      return `We are requesting reconsideration of the authorization-related denial for ${cpts}. Please compare the claim to the authorization requirements and authorization information applicable to this member, provider, service, and date of service.${authorizationFacts(context)} If authorization was in place, was not required, or the submitted documentation supports another applicable exception, please reverse the denial and reprocess the claim.`;
    case "bundling":
      return `We are requesting reconsideration of the determination that ${cpts} was included in or bundled with another service. The claim and clinical record should be reviewed to determine whether the reported services were separately reportable under the payer's applicable coding and reimbursement policy.${duration} When the documentation and coding satisfy the applicable requirements, please reprocess the claim. If the denial is upheld, please identify the specific coding or reimbursement policy applied.`;
    case "noncovered":
      return `We are requesting reconsideration of the determination that ${cpts} is noncovered under the member's current benefit plan. Please review the benefit plan and coverage information applicable on the date of service. If the service is excluded, please identify the specific plan provision or exclusion relied upon. If the service is covered but subject to different authorization, network, coding, or utilization requirements, please identify those requirements and reprocess the claim when they are satisfied.`;
    case "duplicate":
      return `We are requesting reconsideration of the duplicate-claim denial. Please compare this claim to the previously adjudicated claim history, including date of service, procedure code, rendering provider, service time when applicable, and claim status. The supporting documentation should be used to determine whether this represents a separately reportable service, a corrected/replacement claim, or an incorrectly identified duplicate. Please reprocess the claim if it is not an exact duplicate.`;
    case "benefit_limit":
      return `We are requesting review of the determination that an applicable benefit maximum has been reached. Please confirm the benefit period, applicable maximum, services accumulated toward that maximum, dates of service counted, and remaining benefit, if any. If the benefit accumulation was applied incorrectly, please correct the member's benefit record and reprocess the claim.`;
    case "level_of_service":
      return `We are appealing the determination that the documentation does not support the reported level of service for ${cpts}. The complete clinical record should be reviewed for the service performed, clinical work documented, and any time requirements applicable to the reported code.${duration} Please reconsider the denial based on the complete record. If the determination is upheld, please identify the specific clinical or coding criteria relied upon.`;
    case "frequency":
      return `We are appealing the determination that the documentation does not support the frequency of behavioral health services. Treatment frequency was determined by the treating clinician based on the patient's documented presentation, functional impairment, treatment goals, response to treatment, and continuing treatment needs. Please review the treatment history and supporting records and reprocess the claim when the documented frequency satisfies the applicable criteria.`;
    case "length_of_service":
      return `We are appealing the determination that the documentation does not support the length of the reported psychotherapy service. The clinical record should be reviewed for the actual psychotherapy time and the interventions performed.${duration} Please reconsider the denial based on the complete documentation and reprocess the claim when the recorded duration supports the reported service.`;
    case "documentation":
      return `We are requesting reconsideration of the documentation-related denial. The requested clinical record is being supplied for review. Please evaluate the complete signed record, including the patient's presenting condition, diagnosis, treatment goals, interventions, response, service duration when applicable, treatment plan, and provider authentication. If additional information is still required, please identify the specific missing documentation or policy requirement.`;
    default:
      return `We are requesting reconsideration of the above-referenced behavioral health claim. Please conduct a complete review of the claim, member benefits, provider status, coding, applicable payer policies, and supporting documentation. If the denial is upheld, please provide the specific benefit, clinical, coding, reimbursement, or contractual provision supporting the determination.`;
  }
}

export function buildAppealLetter(context: AppealTemplateContext) {
  const guidance = getDenialGuidance({
    carcCode: context.carcCode,
    rarcCode: context.rarcCode,
    category: context.denialCategory,
    reason: context.denialReason,
  });
  const cpts = join(context.cptCodes);
  const diagnoses = join(context.diagnosisCodes);
  const provider = [present(context.renderingProviderName), present(context.renderingProviderCredentials)].filter(Boolean).join(", ");
  const codePair = [present(context.carcCode) ? `CARC ${present(context.carcCode)}` : "", present(context.rarcCode) ? `RARC ${present(context.rarcCode)}` : ""].filter(Boolean).join(" / ");

  const header = [
    headerLine("Patient", context.patientName),
    headerLine("DOB", context.dateOfBirth),
    headerLine("Member ID", context.memberId),
    headerLine("Payer", context.payerName),
    headerLine("Claim number", context.claimNumber),
    headerLine("Payer claim number", context.payerClaimNumber),
    headerLine("Date of service", context.serviceDate),
    headerLine("CPT code(s)", cpts),
    headerLine("Diagnosis code(s)", diagnoses),
    headerLine("Rendering provider", provider),
    headerLine("Rendering NPI", context.renderingProviderNpi),
    headerLine("Billing provider", context.billingProviderName),
    headerLine("Billing NPI", context.billingProviderNpi),
    headerLine("Denial code", codePair),
    headerLine("Denied amount", dollars(context.deniedAmountCents)),
  ].filter(Boolean).join("\n");

  const reason = present(context.denialReason);
  const supportingFacts = present(context.supportingFacts);

  return [
    "To: Claims Review Department",
    header ? `\n${header}` : "",
    `\nRE: Request for Reconsideration / Appeal — ${guidance.title}`,
    reason ? `\nDenial reason: ${reason}` : "",
    `\n\n${bodyFor(context)}`,
    supportingFacts ? `\n\nAdditional supporting facts:\n${supportingFacts}` : "",
    "\n\nBased on the documentation submitted, we request reconsideration and appropriate reprocessing of the claim. If the denial is upheld, please provide a written determination identifying the specific factual basis and applicable benefit, clinical, coding, reimbursement, or contractual provision supporting the decision.",
    "\n\nSincerely,\n[Practice / Billing Representative]",
  ].filter(Boolean).join("");
}
