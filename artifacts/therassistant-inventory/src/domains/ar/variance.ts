type ClaimLineLike = Record<string, unknown>;
type FeeScheduleLineLike = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function expectedAllowedForLine(
  line: ClaimLineLike,
  feeScheduleLines: FeeScheduleLineLike[],
): number | null {
  const cptCode = clean(line.cpt_code);
  if (!cptCode) return null;

  const modifier = clean(line.modifier1);
  const candidates = feeScheduleLines.filter((row) => clean(row.cpt_code) === cptCode);
  const exact = modifier ? candidates.find((row) => clean(row.modifier) === modifier) : undefined;
  const fallback = candidates.find((row) => !clean(row.modifier));
  const match = exact ?? fallback;
  if (!match) return null;

  const rateCents = Number(match.rate_cents ?? 0);
  const units = Number(line.units ?? 1);
  if (!Number.isFinite(rateCents) || rateCents < 0 || !Number.isFinite(units) || units <= 0) return null;
  return Math.round(rateCents * units);
}

export function calculateContractVariance(expectedAllowedCents: number, actualAllowedCents: number) {
  if (!Number.isFinite(expectedAllowedCents) || expectedAllowedCents < 0) {
    throw new Error("Expected allowed amount must be zero or greater.");
  }
  if (!Number.isFinite(actualAllowedCents) || actualAllowedCents < 0) {
    throw new Error("Actual allowed amount must be zero or greater.");
  }
  return Math.max(0, Math.round(expectedAllowedCents) - Math.round(actualAllowedCents));
}

export function isRecoveryAdjustment(adjustmentType: unknown) {
  return ["recoupment", "refund_correction"].includes(clean(adjustmentType));
}
