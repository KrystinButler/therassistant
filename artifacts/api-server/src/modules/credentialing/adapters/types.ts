import type {
  PayerEvidence,
  VerificationFailureCode,
  VerificationRequest,
} from "../types";

export type CatalogSyncResult = {
  status: "completed" | "failed";
  recordsAdded: number;
  recordsChanged: number;
  recordsDeactivated: number;
  sourceVersion: string | null;
  errorSummary: string | null;
};

export type AdapterHealth = {
  sourceKey: string;
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "MISCONFIGURED";
  checkedAt: string;
  sourceUpdatedAt: string | null;
  responseTimeMs: number | null;
  failureCode: VerificationFailureCode | null;
  failureDetail: string | null;
  adapterVersion: string;
};

export interface PayerAdapter {
  readonly key: string;
  readonly version: string;

  syncCatalog(): Promise<CatalogSyncResult>;

  verifyParticipation(
    request: VerificationRequest,
  ): Promise<PayerEvidence>;

  healthCheck(): Promise<AdapterHealth>;
}

// SPEC-1 structured failure categories. Keep these visible at the adapter
// boundary so payer implementations cannot collapse source errors into NOT_FOUND.
export const ADAPTER_FAILURE_CODES = [
  "TRANSIENT_NETWORK",
  "RATE_LIMITED",
  "AUTHENTICATION_FAILED",
  "SOURCE_UNAVAILABLE",
  "INVALID_RESPONSE",
  "PROVIDER_NOT_FOUND",
  "PLAN_NOT_FOUND",
  "AMBIGUOUS_RESULT",
] as const satisfies readonly VerificationFailureCode[];
