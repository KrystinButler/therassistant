import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";
import { calculateOpenBalance } from "../ar/aging";
import { isRecoveryAdjustment } from "../ar/variance";

type DataRow = Row & { id: string };

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export async function allocateExistingPayment(paymentId: string, claimId: string, requestedAmountCents: number) {
  if (!paymentId || !claimId) throw new Error("Payment and claim are required.");
  if (!Number.isFinite(requestedAmountCents) || requestedAmountCents <= 0) {
    throw new Error("Allocation amount must be greater than zero.");
  }

  const [payment, claim] = await Promise.all([
    tenantSelect<DataRow>("payments", { id: `eq.${paymentId}`, limit: "1" }).then((rows) => rows[0] ?? null),
    tenantSelect<DataRow>("professional_claims", { id: `eq.${claimId}`, limit: "1" }).then((rows) => rows[0] ?? null),
  ]);
  if (!payment) throw new Error("Payment not found.");
  if (!claim) throw new Error("Claim not found.");
  if (["reversed", "voided"].includes(String(payment.payment_status ?? ""))) {
    throw new Error("Reversed or voided payments cannot be allocated.");
  }

  const source = String(payment.payment_source ?? "");
  if (source === "insurance" && payment.payer_id && claim.payer_id && String(payment.payer_id) !== String(claim.payer_id)) {
    throw new Error("Insurance payment payer does not match the selected claim.");
  }
  if (source === "patient" && payment.client_id && claim.client_id && String(payment.client_id) !== String(claim.client_id)) {
    throw new Error("Patient payment does not match the selected claim.");
  }

  const [allocations, adjustments] = await Promise.all([
    tenantSelect<DataRow>("payment_allocations", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("adjustments", { claim_id: `eq.${claimId}`, order: "created_at.desc" }),
  ]);
  const paymentAllocations = await tenantSelect<DataRow>("payment_allocations", {
    payment_id: `eq.${paymentId}`,
    order: "created_at.desc",
  });

  const activeClaimAllocations = allocations.filter((row) => !row.reversed_at);
  const activePaymentAllocations = paymentAllocations.filter((row) => !row.reversed_at);
  const activeAdjustments = adjustments.filter(
    (row) => !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
  );
  const reducingAdjustments = activeAdjustments.filter((row) => !isRecoveryAdjustment(row.adjustment_type));
  const recoveryAdjustments = activeAdjustments.filter((row) => isRecoveryAdjustment(row.adjustment_type));

  const paymentAmountCents = Number(payment.amount_cents ?? 0);
  const alreadyAllocatedCents = total(activePaymentAllocations, "amount_cents");
  const availablePaymentCents = Math.max(0, paymentAmountCents - alreadyAllocatedCents);
  const claimPaidCents = total(activeClaimAllocations, "amount_cents");
  const claimOpenBalanceCents = calculateOpenBalance(
    Number(claim.total_charge_cents ?? 0),
    claimPaidCents,
    total(reducingAdjustments, "amount_cents"),
    total(recoveryAdjustments, "amount_cents"),
  );
  const amountCents = Math.min(requestedAmountCents, availablePaymentCents, claimOpenBalanceCents);
  if (amountCents <= 0) throw new Error("No allocatable balance remains for this payment and claim.");

  const allocation = await tenantInsert<DataRow>("payment_allocations", {
    payment_id: paymentId,
    client_id: claim.client_id || payment.client_id || null,
    claim_id: claimId,
    claim_line_id: null,
    amount_cents: amountCents,
  });

  const totalAllocatedCents = alreadyAllocatedCents + amountCents;
  const unappliedCents = Math.max(0, paymentAmountCents - totalAllocatedCents);
  const paymentStatus = unappliedCents > 0 ? "partially_applied" : "posted";
  await tenantUpdate<DataRow>("payments", paymentId, {
    payment_status: paymentStatus,
    posted_at: new Date().toISOString(),
    ...(source === "insurance" && !payment.payer_id ? { payer_id: claim.payer_id || null } : {}),
    ...(source === "patient" && !payment.client_id ? { client_id: claim.client_id || null } : {}),
  });

  const remainingClaimBalanceCents = Math.max(0, claimOpenBalanceCents - amountCents);
  const claimStatus = remainingClaimBalanceCents === 0
    ? "paid"
    : source === "patient" && String(claim.claim_status ?? "") === "patient_responsibility"
      ? "patient_responsibility"
      : "partially_paid";
  await tenantUpdate<DataRow>("professional_claims", claimId, {
    claim_status: claimStatus,
    ...(claimStatus === "paid" ? { paid_at: new Date().toISOString() } : {}),
  });

  return { allocation, amountCents, unappliedCents, paymentStatus, claimStatus };
}
