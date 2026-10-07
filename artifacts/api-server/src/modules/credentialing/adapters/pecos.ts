import { lookupCmsMedicareEnrollment } from "../../../lib/credentialing-directory";
import type { NormalizedEvidence, VerificationRequest } from "../types";

/**
 * PECOS evidence establishes Medicare FFS enrollment only. It must never be
 * interpreted as Medicare Advantage plan/network participation.
 */
export async function getMedicareFfsEnrollmentEvidence(
  request: VerificationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedEvidence> {
  const observation = await lookupCmsMedicareEnrollment(
    request.providerNpi,
    fetchImpl,
  );

  return {
    sourceKey: observation.sourceKey,
    sourceType: "CMS_PECOS_MEDICARE_FFS",
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
