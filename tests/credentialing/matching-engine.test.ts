import assert from "node:assert/strict";
import test from "node:test";

import { evaluateParticipation } from "../../artifacts/api-server/src/modules/credentialing/matching-engine.ts";
import type {
  NormalizedEvidence,
  VerificationRequest,
} from "../../artifacts/api-server/src/modules/credentialing/types.ts";

const request: VerificationRequest = {
  tenantId: "tenant-1",
  providerId: "provider-1",
  organizationId: "org-1",
  practiceLocationId: "location-1",
  payerId: "payer-1",
  planId: "plan-1",
  networkId: "network-1",
  providerNpi: "1234567890",
  organizationNpi: "0987654321",
  taxonomyCode: "1041C0700X",
  state: "CO",
  postalCode: "80226",
};

function evidence(overrides: Partial<NormalizedEvidence> = {}): NormalizedEvidence {
  return {
    sourceKey: "synthetic",
    sourceType: "FHIR_PROVIDER_DIRECTORY",
    sourceReference: "record-1",
    sourceUpdatedAt: "2026-10-06T00:00:00Z",
    retrievedAt: "2026-10-07T00:00:00Z",
    adapterVersion: "1.0.0",
    authoritativeSearchCompleted: true,
    providerNpi: "1234567890",
    organizationNpi: "0987654321",
    planId: "plan-1",
    networkId: "network-1",
    state: "CO",
    postalCode: "80226",
    taxonomyCode: "1041C0700X",
    providerNetworkRelationshipConfirmed: true,
    raw: {},
    ...overrides,
  };
}

test("exact NPI plus selected plan and network evidence can establish participation", () => {
  const result = evaluateParticipation(request, { evidence: [evidence()] });
  assert.equal(result.status, "PARTICIPATING");
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.failureCode, null);
});

test("same-name candidate with a different NPI can never establish participation", () => {
  const result = evaluateParticipation(request, {
    evidence: [evidence({ providerNpi: "1111111111" })],
  });
  assert.notEqual(result.status, "PARTICIPATING");
  assert.equal(result.status, "NOT_FOUND");
});

test("provider evidence for a different network does not create a false positive", () => {
  const result = evaluateParticipation(request, {
    evidence: [evidence({ networkId: "network-2", providerNetworkRelationshipConfirmed: false })],
  });
  assert.equal(result.status, "NOT_FOUND");
});

test("Type 1 match cannot overcome a Type 2 mismatch when group context was selected", () => {
  const result = evaluateParticipation(request, {
    evidence: [evidence({ organizationNpi: "2222222222" })],
  });
  assert.notEqual(result.status, "PARTICIPATING");
});

test("source failure always becomes unable to verify", () => {
  const result = evaluateParticipation(request, {
    evidence: [],
    failureCode: "SOURCE_UNAVAILABLE",
    failureDetail: "directory unavailable",
  });
  assert.equal(result.status, "UNABLE_TO_VERIFY");
  assert.equal(result.failureCode, "SOURCE_UNAVAILABLE");
});

test("successful authoritative search with no qualifying relationship is not found", () => {
  const result = evaluateParticipation(request, {
    evidence: [
      evidence({
        providerNpi: null,
        organizationNpi: null,
        planId: null,
        networkId: null,
        providerNetworkRelationshipConfirmed: false,
      }),
    ],
  });
  assert.equal(result.status, "NOT_FOUND");
});

test("an ambiguous authoritative result remains unable to verify", () => {
  const result = evaluateParticipation(request, {
    evidence: [evidence({ providerNetworkRelationshipConfirmed: false })],
    failureCode: "AMBIGUOUS_RESULT",
    failureDetail: "multiple conflicting provider relationships",
  });
  assert.equal(result.status, "UNABLE_TO_VERIFY");
});
