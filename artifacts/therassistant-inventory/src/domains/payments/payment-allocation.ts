import {
  getCurrentTenantId,
  tenantRpc,
} from "../../lib/tenant-data-client";

type AllocationResult = {
  payment_id: string;
  allocation_cents: number;
  unapplied_cents: number;
  payment_status: string;
  claim_status: string;
};

export async function allocateExistingPayment(
  paymentId: string,
  claimId: string,
  requestedAmountCents: number,
) {
  if (!paymentId || !claimId) throw new Error("Payment and claim are required.");
  if (!Number.isFinite(requestedAmountCents) || requestedAmountCents <= 0) {
    throw new Error("Allocation amount must be greater than zero.");
  }

  const tenantId = await getCurrentTenantId();
  const result = await tenantRpc<AllocationResult>("allocate_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_claim_id: claimId,
    p_amount_cents: requestedAmountCents,
  });

  return {
    paymentId: result.payment_id,
    amountCents: Number(result.allocation_cents ?? 0),
    unappliedCents: Number(result.unapplied_cents ?? 0),
    paymentStatus: String(result.payment_status ?? ""),
    claimStatus: String(result.claim_status ?? ""),
  };
}
