/** The signature timestamp is recorded on clinical_note_signatures, not clinical_notes. */
export function attachClinicalSignatureDates<T extends { id: string }>(
  notes: T[],
  signatures: Record<string, unknown>[],
): Array<T & { signed_at?: string }> {
  const signedAtByNote = new Map<string, string>();
  for (const signature of signatures) {
    const noteId = String(signature.clinical_note_id ?? "");
    const signedAt = String(signature.signed_at ?? "");
    if (!noteId || !signedAt) continue;
    const current = signedAtByNote.get(noteId);
    if (!current || signedAt < current) signedAtByNote.set(noteId, signedAt);
  }
  return notes.map((note) => {
    const signedAt = signedAtByNote.get(note.id);
    return signedAt ? { ...note, signed_at: signedAt } : note;
  });
}
