import type { Row } from "../../lib/tenant-data-client";

export type FundingSourceType = "insurance" | "government_program" | "private_pay";
export type BillingPath = "insurance_claim" | "program_invoice_voucher" | "private_pay";

export const FUNDING_SOURCE_OPTIONS: Array<{ id: FundingSourceType; label: string }> = [
  { id: "insurance", label: "Insurance / Health Plan" },
  { id: "government_program", label: "Government / Program Funding" },
  { id: "private_pay", label: "Private Pay" },
];

const SUBTYPE_OPTIONS: Record<FundingSourceType, Array<{ id: string; label: string }>> = {
  insurance: [
    { id: "commercial", label: "Commercial" },
    { id: "medicaid", label: "Medicaid" },
    { id: "medicare", label: "Medicare" },
    { id: "other_health_plan", label: "Other Health Plan" },
  ],
  government_program: [
    { id: "state", label: "State Program" },
    { id: "judicial", label: "Judicial / Court" },
    { id: "probation_parole", label: "Probation / Parole" },
    { id: "behavioral_health", label: "Behavioral Health Program" },
    { id: "contracted", label: "Contracted Program" },
  ],
  private_pay: [
    { id: "patient", label: "Patient" },
    { id: "family", label: "Family / Responsible Party" },
    { id: "attorney_law_firm", label: "Attorney / Law Firm" },
    { id: "private_court_contract", label: "Private Court Contract" },
  ],
};

const validSources = new Set<FundingSourceType>(FUNDING_SOURCE_OPTIONS.map((item) => item.id));
const validPaths = new Set<BillingPath>(["insurance_claim", "program_invoice_voucher", "private_pay"]);

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export function fundingSubtypeOptions(source: FundingSourceType) {
  return SUBTYPE_OPTIONS[source];
}

export function fundingSourceLabel(source: FundingSourceType) {
  return FUNDING_SOURCE_OPTIONS.find((item) => item.id === source)?.label ?? source.replaceAll("_", " ");
}

export function billingPathForFundingSource(source: FundingSourceType): BillingPath {
  if (source === "government_program") return "program_invoice_voucher";
  if (source === "private_pay") return "private_pay";
  return "insurance_claim";
}

export function billingPathLabel(path: BillingPath) {
  if (path === "program_invoice_voucher") return "Program Invoice / Voucher";
  if (path === "private_pay") return "Private Pay / Patient Responsibility";
  return "Insurance Claim";
}

export function legacyFundingSourceType(billingType?: string | null): FundingSourceType {
  return billingType === "self_pay" ? "private_pay" : "insurance";
}

export function resolveEncounterFunding(
  encounter: Row,
  legacyBillingType?: string | null,
): {
  sourceType: FundingSourceType;
  sourceSubtype: string;
  billingPath: BillingPath;
  context: Row;
} {
  const rawSource = String(encounter.funding_source_type ?? "") as FundingSourceType;
  const sourceType = validSources.has(rawSource)
    ? rawSource
    : legacyFundingSourceType(legacyBillingType);
  const rawPath = String(encounter.billing_path ?? "") as BillingPath;
  const expectedPath = billingPathForFundingSource(sourceType);
  const billingPath = validPaths.has(rawPath) && rawPath === expectedPath ? rawPath : expectedPath;
  return {
    sourceType,
    sourceSubtype: String(encounter.funding_source_subtype ?? ""),
    billingPath,
    context: objectValue(encounter.funding_context),
  };
}
