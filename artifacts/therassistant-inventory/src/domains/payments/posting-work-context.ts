type WorkItem = Record<string, unknown> & { id: string };
type EraClaim = Record<string, unknown> & { id: string };

/** Preserve the exact task; never guess one ERA when several reference its claim. */
export function resolvePostingWorkContext<W extends WorkItem, E extends EraClaim>(
  workItem: W | null, eraClaims: E[],
): { workItem: W; eraClaims: E[] } | null {
  if (!workItem || !["payment_posting_issue", "payment_exception", "unapplied_payment", "unmatched_era", "era_match_exception", "era_import"].includes(String(workItem.workqueue_type ?? "").trim().toLowerCase())) return null;
  const sourceType = String(workItem.source_object_type ?? "").trim().toLowerCase();
  const sourceId = String(workItem.source_object_id ?? "");
  if (!sourceId || !["claim", "era"].includes(sourceType)) return null;
  return {
    workItem,
    eraClaims: eraClaims.filter((row) => String(sourceType === "claim" ? row.claim_id ?? "" : row.era_file_id ?? "") === sourceId),
  };
}
