export type EncounterAuthoringAccessKind =
  | "ready"
  | "clinician_role_required"
  | "rendering_provider_required"
  | "auto_link_required"
  | "provider_mismatch";

export type EncounterAuthoringAccessDecision = {
  kind: EncounterAuthoringAccessKind;
  canAuthor: boolean;
  canSign: boolean;
  shouldAttemptAutoLink: boolean;
};

export type EncounterAuthoringAccessInput = {
  encounterProviderId: string | null;
  isClinician: boolean;
  isLinkedProvider: boolean;
  linkedProviderIds: string[];
};

export function decideEncounterAuthoringAccess(
  input: EncounterAuthoringAccessInput,
): EncounterAuthoringAccessDecision {
  const encounterProviderId = input.encounterProviderId?.trim() || null;

  if (!encounterProviderId) {
    return {
      kind: "rendering_provider_required",
      canAuthor: false,
      canSign: false,
      shouldAttemptAutoLink: false,
    };
  }

  if (!input.isClinician) {
    return {
      kind: "clinician_role_required",
      canAuthor: false,
      canSign: false,
      shouldAttemptAutoLink: false,
    };
  }

  const linkedProviderIds = input.linkedProviderIds.filter(Boolean);
  const linkedToEncounterProvider =
    input.isLinkedProvider || linkedProviderIds.includes(encounterProviderId);

  if (linkedToEncounterProvider) {
    return {
      kind: "ready",
      canAuthor: true,
      canSign: true,
      shouldAttemptAutoLink: false,
    };
  }

  if (linkedProviderIds.length === 0) {
    return {
      kind: "auto_link_required",
      canAuthor: false,
      canSign: false,
      shouldAttemptAutoLink: true,
    };
  }

  return {
    kind: "provider_mismatch",
    canAuthor: false,
    canSign: false,
    shouldAttemptAutoLink: false,
  };
}
