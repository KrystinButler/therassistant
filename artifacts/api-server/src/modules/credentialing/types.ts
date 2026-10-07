export type VerificationStatus =
  | "IN_PROGRESS"
  | "PARTICIPATING"
  | "NOT_FOUND"
  | "UNABLE_TO_VERIFY";

export type VerificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type VerificationFailureCode =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMITED"
  | "AUTHENTICATION_FAILED"
  | "SOURCE_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "PROVIDER_NOT_FOUND"
  | "PLAN_NOT_FOUND"
  | "AMBIGUOUS_RESULT";

export type CredentialingVerificationJob = {
  runId: string;
  tenantId: string;
};

export type VerificationRequest = {
  tenantId: string;
  providerId: string;
  organizationId: string | null;
  practiceLocationId: string | null;
  payerId: string;
  planId: string;
  networkId: string | null;
  providerNpi: string;
  organizationNpi: string | null;
  taxonomyCode: string | null;
  state: "CO";
  postalCode: string | null;
};

export type NormalizedEvidence = {
  sourceKey: string;
  sourceType: string;
  sourceReference: string | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  adapterVersion: string;
  authoritativeSearchCompleted: boolean;
  providerNpi: string | null;
  organizationNpi: string | null;
  planId: string | null;
  networkId: string | null;
  state: string | null;
  postalCode: string | null;
  taxonomyCode: string | null;
  providerNetworkRelationshipConfirmed: boolean;
  raw: unknown;
};

export type PayerEvidence = {
  evidence: NormalizedEvidence[];
  failureCode?: VerificationFailureCode;
  failureDetail?: string;
  officialFallbackUrl?: string;
};

export type VerificationDecision = {
  status: Exclude<VerificationStatus, "IN_PROGRESS">;
  confidence: VerificationConfidence;
  sourceType: string | null;
  sourceReference: string | null;
  sourceUpdatedAt: string | null;
  failureCode: VerificationFailureCode | null;
  failureDetail: string | null;
  matches: Array<{
    matchType: string;
    expectedValue: string | null;
    observedValue: string | null;
    matched: boolean;
    score: number | null;
    sourceReference: string | null;
  }>;
};
