import { blocked, failure, success, type WorkflowResult } from "../shared/workflow-result";

export type ClinicalSigningRepository = {
  getClinicalState(encounterId: string): Promise<{
    encounter: Record<string, any> | null;
    note: Record<string, any> | null;
    diagnoses: Array<Record<string, any>>;
    serviceLines: Array<Record<string, any>>;
  }>;
  signNoteAtomically(encounterId: string, noteId: string, providerId: string, signatureText: string): Promise<{
    note_id: string; signed_at: string;
  }>;
  runBillingReadiness(encounterId: string): Promise<unknown>;
};

export async function signNoteWorkflow(
  repo: ClinicalSigningRepository,
  encounterId: string,
  providerId: string,
  signatureText: string,
  expectedNoteId?: string,
): Promise<WorkflowResult<{ noteId: string; signedAt: string; billingPending: boolean }>> {
  if (!providerId || !signatureText.trim()) {
    return blocked(
      "signature_required",
      "Signing provider identity and signature text are required before signing.",
    );
  }

  const state = await repo.getClinicalState(encounterId);
  if (!state.encounter) {
    return failure("encounter_not_found", "Encounter not found.");
  }
  if (!state.note) {
    return blocked("note_missing", "Create a clinical note before signing.");
  }
  if (expectedNoteId && String(state.note.id) !== expectedNoteId) {
    return failure("note_changed", "The encounter note changed before signing. Reload and review the current note.");
  }

  const encounterProviderId = String(state.encounter.provider_id ?? "");
  if (encounterProviderId && encounterProviderId !== providerId) {
    return blocked(
      "signer_provider_mismatch",
      "The signing provider must match the encounter provider in the demo workflow.",
    );
  }

  const noteText = String(state.note.note_text ?? "").trim();
  if (!noteText) {
    return blocked("note_text_missing", "Clinical note text is required before signing.");
  }
  // Diagnosis, coding, charge, eligibility, and enrollment requirements
  // belong to billing readiness. They must not block a provider
  // from completing and signing the clinical record.

  let signed: { note_id: string; signed_at: string };

  try {
    signed = await repo.signNoteAtomically(encounterId, String(state.note.id), providerId, signatureText.trim());
  } catch (error) {
    return failure(
      "note_sign_failed",
      error instanceof Error ? error.message : "Unable to sign clinical note.",
    );
  }

  let billingPending = false;
  try {
    const readiness = await repo.runBillingReadiness(encounterId) as { ok?: boolean } | undefined;
    billingPending = readiness?.ok === false;
  } catch {
    // The signature and recovery task already committed together. Do not ask
    // the clinician to re-sign when billing is unavailable.
    billingPending = true;
  }

  return success({ noteId: signed.note_id, signedAt: signed.signed_at, billingPending });
}
