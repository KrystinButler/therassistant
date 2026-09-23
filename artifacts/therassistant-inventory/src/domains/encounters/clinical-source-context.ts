import type { PatientReviewCheckIn } from "../scheduling/patient-review-model";

type Row = Record<string, unknown>;

export function isSharedJournalEntry(row: Row | null | undefined) {
  if (!row) return false;
  return (
    String(row.visibility ?? "") === "shared_with_provider" &&
    String(row.entry_status ?? "submitted") !== "draft" &&
    Boolean(String(row.entry_text ?? "").trim())
  );
}

export function latestSharedJournalEntry(rows: Row[]) {
  return rows
    .filter(isSharedJournalEntry)
    .sort((a, b) =>
      String(b.entry_date ?? b.created_at ?? "").localeCompare(
        String(a.entry_date ?? a.created_at ?? ""),
      ),
    )[0] ?? null;
}

export function buildPreVisitNoteInsert(review: PatientReviewCheckIn) {
  if (!review.hasSubmittedPreVisit) return "";

  const lines = ["PATIENT-REPORTED PRE-VISIT INFORMATION (Patient Portal)"];
  if (review.focus) lines.push(`Focus for visit: ${review.focus}`);
  if (review.mood) lines.push(`Since last visit: ${review.mood}`);
  if (review.changes.length) lines.push(`Important changes: ${review.changes.join("; ")}`);
  if (review.safetyText) lines.push(`Safety response: ${review.safetyText}`);
  if (review.treatmentGoal) lines.push(`Patient-stated treatment goal: ${review.treatmentGoal}`);
  if (review.additionalContext) lines.push(`Additional context: ${review.additionalContext}`);

  return lines.length > 1 ? lines.join("\n") : "";
}

export function buildJournalNoteInsert(row: Row | null | undefined) {
  if (!isSharedJournalEntry(row)) return "";
  const date = String(row?.entry_date ?? row?.created_at ?? "").slice(0, 10);
  const text = String(row?.entry_text ?? "").trim();
  return [
    "--------------------------------------------------",
    "[PATIENT JOURNAL IMPORT — PATIENT-AUTHORED CONTENT]",
    date ? `Entry date: ${date}` : "",
    `Patient text: "${text}"`,
    "[END PATIENT JOURNAL IMPORT]",
    "--------------------------------------------------",
  ].filter(Boolean).join("\n");
}

export function appendClinicalSource(current: string, block: string) {
  const trimmed = block.trim();
  if (!trimmed) return current;
  if (current.includes(trimmed)) return current;
  return current.trim()
    ? `${current.trim()}\n\n${trimmed}`
    : trimmed;
}

export type ClinicalSourceProvenance = {
  source_type: "pre_visit_checkin" | "journal_entry";
  source_id: string;
  source_date: string | null;
  patient_authored: true;
};

export function buildClinicalSourceProvenance(
  sourceType: ClinicalSourceProvenance["source_type"],
  row: Row | null | undefined,
): ClinicalSourceProvenance | null {
  const sourceId = String(row?.id ?? "").trim();
  if (!sourceId) return null;
  const date = String(
    row?.submitted_at ??
    row?.entry_date ??
    row?.completed_at ??
    row?.created_at ??
    "",
  ).slice(0, 10);
  return {
    source_type: sourceType,
    source_id: sourceId,
    source_date: date || null,
    patient_authored: true,
  };
}

export function withClinicalSourceImport(
  context: Row,
  provenance: ClinicalSourceProvenance | null,
) {
  if (!provenance) return context;
  const current = Array.isArray(context.source_imports)
    ? context.source_imports.filter(
        (item): item is ClinicalSourceProvenance =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
  const exists = current.some(
    (item) =>
      item.source_type === provenance.source_type &&
      item.source_id === provenance.source_id,
  );
  return {
    ...context,
    source_imports: exists ? current : [...current, provenance],
  };
}
