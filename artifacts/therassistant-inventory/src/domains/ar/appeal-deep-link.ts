type Appeal = { id: string; denial_id?: unknown; appeal_status?: unknown };
type Denial = { id: string; denial_status?: unknown; payer_id?: unknown };

/** Select only the requested active appeal in the active denial queue. */
export function resolveAppealDeepLink<A extends Appeal, D extends Denial>(
  id: string | null, appeals: A[], denials: D[],
): { appeal: A; denial: D } | null {
  if (!id) return null;
  const appeal = appeals.find((row) => row.id === id
    && ["not_started", "drafting", "submitted", "pending"].includes(String(row.appeal_status ?? "")));
  if (!appeal) return null;
  const denial = denials.find((row) => row.id === String(appeal.denial_id ?? "")
    && !["resolved", "resolved_writeoff", "closed"].includes(String(row.denial_status ?? "")));
  return denial ? { appeal, denial } : null;
}
