import { lookupNppesProvider } from "../../../lib/credentialing-directory";
import type { NormalizedEvidence, VerificationRequest } from "../types";

/**
 * NPPES is provider identity/taxonomy/location evidence. It is not payer-network
 * participation evidence and can never independently confirm participation.
 */
export async function getNppesIdentityEvidence(
  request: VerificationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvidence> {
  const observation = await lookupNppesProvider(request.providerNpi, fetchImpl);

  return {
    sourceKey: observation.sourceKey,
    sourceType: "NPPES_IDENTITY",
    sourceReference: observation.sourceRecordId,
    sourceUpdatedAt: observation.sourceUpdatedAt,
    retrievedAt: observation.checkedAt,
    adapterVersion: "1.0.0",
    authoritativeSearchCompleted:
      observation.directoryStatus === "found" || observation.directoryStatus === "not_found",
    providerNpi:
      observation.directoryStatus === "found" ? observation.providerNpi : null,
    organizationNpi: null,
    planId: null,
    networkId: null,
    state: observation.locationText?.includes("CO") ? "CO" : null,
    postalCode: null,
    taxonomyCode: null,
    providerNetworkRelationshipConfirmed: false,
    raw: observation.rawResult,
  };
}
