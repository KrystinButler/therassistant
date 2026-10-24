export type ReceivableClaim = {
  id?: unknown;
  claim_status?: unknown;
  submitted_at?: unknown;
  accepted_at?: unknown;
};

/** Payer follow-up A/R requires evidence of claim transmission or a payer-facing state.
 * Pre-submission work is still financially outstanding, but is tracked separately.
 * Historically transmitted claims being corrected or rebatched remain payer A/R.
 */
export function isPayerReceivable(
  claim: ReceivableClaim,
  transmittedClaimIds: ReadonlySet<string> = new Set<string>(),
): boolean {
  const status = String(claim.claim_status ?? "").trim().toLowerCase();
  if (["voided", "reversed"].includes(status)) return false;
  const evidence = Boolean(claim.submitted_at || claim.accepted_at) ||
    transmittedClaimIds.has(String(claim.id ?? ""));
  if (evidence) return true;
  return ["submitted", "accepted", "partially_paid", "paid", "rejected", "denied", "appealed"].includes(status);
}
