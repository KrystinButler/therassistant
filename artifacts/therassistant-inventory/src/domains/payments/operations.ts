export type PaymentSource = "insurance" | "patient" | "third_party" | "historical" | "transfer" | "refund" | "adjustment" | "other";
export type PaymentMethod = "eft" | "ach" | "check" | "credit_card" | "debit_card" | "cash" | "money_order" | "portal" | "manual" | "other";

const SOURCES: PaymentSource[] = ["insurance", "patient", "third_party", "historical", "transfer", "refund", "adjustment", "other"];
const METHODS: PaymentMethod[] = ["eft", "ach", "check", "credit_card", "debit_card", "cash", "money_order", "portal", "manual", "other"];

export function calculateUnapplied(paymentAmountCents: number, allocationAmountsCents: number[]) {
  if (!Number.isFinite(paymentAmountCents) || paymentAmountCents < 0) throw new Error("Payment amount cannot be negative.");
  if (allocationAmountsCents.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error("Allocation amounts cannot be negative.");
  const allocated = allocationAmountsCents.reduce((sum, amount) => sum + amount, 0);
  if (allocated > paymentAmountCents) throw new Error("Allocations exceed the payment amount.");
  return paymentAmountCents - allocated;
}

export function buildAllocationPlan(paymentAmountCents: number, allocationAmountsCents: number[]) {
  const unappliedCents = calculateUnapplied(paymentAmountCents, allocationAmountsCents);
  const allocatedCents = paymentAmountCents - unappliedCents;
  const status = allocatedCents === 0 ? "unapplied" : unappliedCents === 0 ? "posted" : "partially_applied";
  return { allocatedCents, unappliedCents, status } as const;
}

export function capAllocationToOpenBalance(requestedCents: number, openBalanceCents: number) {
  if (!Number.isFinite(requestedCents) || requestedCents < 0) throw new Error("Requested allocation cannot be negative.");
  if (!Number.isFinite(openBalanceCents) || openBalanceCents < 0) throw new Error("Claim open balance cannot be negative.");
  return Math.min(requestedCents, openBalanceCents);
}

export function validatePaymentDraft(input: { amountCents: number; source: string; method: string }) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) throw new Error("Payment amount must be greater than zero.");
  if (!SOURCES.includes(input.source as PaymentSource)) throw new Error("Payment source is invalid.");
  const normalizedMethod = input.method === "card" ? "credit_card" : input.method;
  if (!METHODS.includes(normalizedMethod as PaymentMethod)) throw new Error("Payment method is invalid.");
  return { amountCents: input.amountCents, source: input.source as PaymentSource, method: normalizedMethod as PaymentMethod };
}

export function resolvePaymentOwnership(input: {
  source: string;
  requestedClientId?: string;
  requestedPayerId?: string;
  claimClientId?: string;
  claimPayerId?: string;
}) {
  const clientId = input.claimClientId || input.requestedClientId || null;
  const payerId = input.source === "insurance"
    ? (input.claimPayerId || input.requestedPayerId || null)
    : null;
  return { clientId, payerId };
}

export function deriveClaimFinancialStatus(input: {
  chargeCents: number;
  paidCents: number;
  adjustmentCents: number;
  recoveryCents?: number;
}) {
  const recoveryCents = input.recoveryCents ?? 0;
  const openBalanceCents = Math.max(
    0,
    input.chargeCents - input.paidCents - input.adjustmentCents + recoveryCents,
  );
  if (openBalanceCents === 0) return "paid" as const;
  if (input.paidCents > 0 || input.adjustmentCents > 0 || recoveryCents > 0) {
    return "partially_paid" as const;
  }
  return "accepted" as const;
}

export function buildPaymentReversal(input: { paymentId: string; allocationIds: string[]; reason: string }) {
  if (!input.paymentId) throw new Error("Payment is required.");
  if (!input.reason.trim()) throw new Error("Reversal reason is required.");
  return {
    paymentId: input.paymentId,
    allocationIds: [...input.allocationIds],
    reason: input.reason.trim(),
    paymentStatus: "reversed" as const,
    reversedAt: new Date().toISOString(),
  };
}
