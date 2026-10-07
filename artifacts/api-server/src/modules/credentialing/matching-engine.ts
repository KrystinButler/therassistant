import type {
  NormalizedEvidence,
  PayerEvidence,
  VerificationDecision,
  VerificationRequest,
} from "./types";

const MATCHING_ALGORITHM_VERSION = "1.0.0";

function same(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function matchFact(
  matchType: string,
  expectedValue: string | null,
  observedValue: string | null,
  sourceReference: string | null,
) {
  return {
    matchType,
    expectedValue,
    observedValue,
    matched: expectedValue === null ? true : same(expectedValue, observedValue),
    score: expectedValue === null ? null : same(expectedValue, observedValue) ? 1 : 0,
    sourceReference,
  };
}

function factsForEvidence(request: VerificationRequest, evidence: NormalizedEvidence) {
  return [
    matchFact("TYPE_1_NPI", request.providerNpi, evidence.providerNpi, evidence.sourceReference),
    matchFact("TYPE_2_NPI", request.organizationNpi, evidence.organizationNpi, evidence.sourceReference),
    matchFact("STATE", request.state, evidence.state, evidence.sourceReference),
    matchFact("POSTAL_CODE", request.postalCode, evidence.postalCode, evidence.sourceReference),
    matchFact("PLAN", request.planId, evidence.planId, evidence.sourceReference),
    matchFact("NETWORK", request.networkId, evidence.networkId, evidence.sourceReference),
    matchFact("TAXONOMY", request.taxonomyCode, evidence.taxonomyCode, evidence.sourceReference),
    {
      matchType: "PROVIDER_NETWORK_RELATIONSHIP",
      expectedValue: "confirmed",
      observedValue: evidence.providerNetworkRelationshipConfirmed ? "confirmed" : "unconfirmed",
      matched: evidence.providerNetworkRelationshipConfirmed,
      score: evidence.providerNetworkRelationshipConfirmed ? 1 : 0,
      sourceReference: evidence.sourceReference,
    },
  ];
}

function qualifies(request: VerificationRequest, evidence: NormalizedEvidence) {
  if (!evidence.authoritativeSearchCompleted) return false;
  if (!same(request.providerNpi, evidence.providerNpi)) return false;
  if (!same(request.planId, evidence.planId)) return false;
  if (request.networkId && !same(request.networkId, evidence.networkId)) return false;
  if (
    request.organizationNpi &&
    !same(request.organizationNpi, evidence.organizationNpi)
  ) return false;
  if (!same(request.state, evidence.state)) return false;
  if (request.postalCode && !same(request.postalCode, evidence.postalCode)) return false;
  return evidence.providerNetworkRelationshipConfirmed;
}

function baseDecision(
  status: VerificationDecision["status"],
  evidence: NormalizedEvidence | undefined,
  payerEvidence: PayerEvidence,
): VerificationDecision {
  return {
    status,
    confidence: status === "PARTICIPATING" ? "HIGH" : status === "NOT_FOUND" ? "MEDIUM" : "LOW",
    sourceType: evidence?.sourceType ?? null,
    sourceReference: evidence?.sourceReference ?? null,
    sourceUpdatedAt: evidence?.sourceUpdatedAt ?? null,
    failureCode: payerEvidence.failureCode ?? null,
    failureDetail: payerEvidence.failureDetail ?? null,
    matches: evidence ? factsForEvidence((null as unknown) as VerificationRequest, evidence) : [],
  };
}

export function evaluateParticipation(
  request: VerificationRequest,
  payerEvidence: PayerEvidence,
): VerificationDecision {
  if (payerEvidence.failureCode) {
    const evidence = payerEvidence.evidence[0];
    return {
      status: "UNABLE_TO_VERIFY",
      confidence: payerEvidence.failureCode === "AMBIGUOUS_RESULT" ? "MEDIUM" : "LOW",
      sourceType: evidence?.sourceType ?? null,
      sourceReference: evidence?.sourceReference ?? null,
      sourceUpdatedAt: evidence?.sourceUpdatedAt ?? null,
      failureCode: payerEvidence.failureCode,
      failureDetail: payerEvidence.failureDetail ?? null,
      matches: evidence ? factsForEvidence(request, evidence) : [],
    };
  }

  const exact = payerEvidence.evidence.find((item) => qualifies(request, item));
  if (exact) {
    return {
      status: "PARTICIPATING",
      confidence: "HIGH",
      sourceType: exact.sourceType,
      sourceReference: exact.sourceReference,
      sourceUpdatedAt: exact.sourceUpdatedAt,
      failureCode: null,
      failureDetail: null,
      matches: factsForEvidence(request, exact),
    };
  }

  const authoritative = payerEvidence.evidence.find(
    (item) => item.authoritativeSearchCompleted,
  );
  if (authoritative) {
    return {
      status: "NOT_FOUND",
      confidence: "MEDIUM",
      sourceType: authoritative.sourceType,
      sourceReference: authoritative.sourceReference,
      sourceUpdatedAt: authoritative.sourceUpdatedAt,
      failureCode: null,
      failureDetail: null,
      matches: factsForEvidence(request, authoritative),
    };
  }

  return {
    status: "UNABLE_TO_VERIFY",
    confidence: "LOW",
    sourceType: payerEvidence.evidence[0]?.sourceType ?? null,
    sourceReference: payerEvidence.evidence[0]?.sourceReference ?? null,
    sourceUpdatedAt: payerEvidence.evidence[0]?.sourceUpdatedAt ?? null,
    failureCode: "SOURCE_UNAVAILABLE",
    failureDetail: "No authoritative payer/network evidence was available.",
    matches: payerEvidence.evidence[0]
      ? factsForEvidence(request, payerEvidence.evidence[0])
      : [],
  };
}

export { MATCHING_ALGORITHM_VERSION };
