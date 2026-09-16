export type ClaimWorkSection =
  | "fields"
  | "lines"
  | "diagnoses"
  | "validation"
  | "responses"
  | "rejections"
  | "denials"
  | "appeals"
  | "work-items"
  | "history";

export type ClaimFieldKey =
  | "patientControlNumber"
  | "payerClaimNumber"
  | "serviceDateFrom"
  | "renderingProvider"
  | "renderingProviderTaxonomy"
  | "billingProvider";

export type ClaimActionableError = {
  id: string;
  kind: "validation" | "rejection";
  summary: string;
  whyItMatters: string;
  correction: string;
  actionLabel: string;
  targetSection: ClaimWorkSection;
  targetField?: ClaimFieldKey;
};
