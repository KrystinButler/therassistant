import { blocked, failure, success, type WorkflowResult } from "../shared/workflow-result";

export type ClinicalSigningRepository = {
  getClinicalState(encounterId: string): Promise<{
    encounter: Record<string, any> | null;
    note: Record<string, any> | null;
    diagnoses: Array<Record<string, any>>;
    serviceLines: Array<Record<string, any>>;
  }>;
  createSignature(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateNote(id: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
  runBillingReadiness(encounterId: string): Promise<unknown>;
};

export async function signNoteWorkflow(
  repo: ClinicalSigningRepository,
  encounterId: string,
  providerId: string,
  signatureText: string,
): Promise<WorkflowResult<{ noteId: string; signedAt: string }>> {
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
  // Diagnosis, coding, charge, eligibility, authorization, and enrollment
  // requirements belong to billing readiness. They must not block a provider
  // from completing and signing the clinical record.

  const signedAt = new Date().toISOString();

  try {
    await repo.createSignature({
      clinical_note_id: state.note.id,
      provider_id: providerId,
      signed_at: signedAt,
      signature_text: signatureText.trim(),
    });

    await repo.updateNote(String(state.note.id), {
      note_status: "signed",
      locked_at: signedAt,
    });
  } catch (error) {
    return failure(
      "note_sign_failed",
      error instanceof Error ? error.message : "Unable to sign clinical note.",
    );
  }

  try {
    await repo.runBillingReadiness(encounterId);
  } catch {
    // The clinical signature is authoritative once saved. A downstream
    // billing-readiness failure must never make the clinical signature fail.
  }

  return success({ noteId: String(state.note.id), signedAt });
}
