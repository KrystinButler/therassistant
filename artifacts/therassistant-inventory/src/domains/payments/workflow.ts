import {
  blocked,
  failure,
  success,
  type WorkflowResult,
} from "../shared/workflow-result";

export type PaymentRow = Record<string, any> & { id: string };

export type PaymentRepository = {
  getClaim(claimId: string): Promise<PaymentRow | null>;
  createPayment(values: Record<string, unknown>): Promise<PaymentRow>;
  updatePayment(paymentId: string, values: Record<string, unknown>): Promise<PaymentRow>;
  createPaymentAllocation(values: Record<string, unknown>): Promise<PaymentRow>;
  createAdjustment(values: Record<string, unknown>): Promise<PaymentRow>;
  createAdjustmentAllocation(values: Record<string, unknown>): Promise<PaymentRow>;
  createEraFile(values: Record<string, unknown>): Promise<PaymentRow>;
  createEraClaim(values: Record<string, unknown>): Promise<PaymentRow>;
  createEraMatch(values: Record<string, unknown>): Promise<PaymentRow>;
  updateEraFile(eraFileId: string, values: Record<string, unknown>): Promise<PaymentRow>;
  updateClaim(claimId: string, values: Record<string, unknown>): Promise<PaymentRow>;
  createDenial(values: Record<string, unknown>): Promise<PaymentRow>;
  upsertWorkItem(values: Record<string, unknown>): Promise<PaymentRow>;
};

export function partitionAdjudicatedBalance(openBalanceCents: number, patientResponsibilityCents: number, patientPaidCents = 0) {
  const remainingPatient = Math.max(0, patientResponsibilityCents - Math.max(0, patientPaidCents));
  const patient = Math.min(remainingPatient, Math.max(0, openBalanceCents));
  return {
    patientResponsibilityCents: patient,
    insuranceResponsibilityCents: Math.max(0, openBalanceCents - patient),
  };
}

export function validateAllocation(
  paymentAmountCents: number,
  allocationAmountsCents: number[],
  unappliedCents: number,
) {
  if (!Number.isFinite(paymentAmountCents) || paymentAmountCents < 0) {
    throw new Error("Payment amount must be zero or greater.");
  }
  if (allocationAmountsCents.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new Error("Allocation amounts cannot be negative.");
  }
  if (!Number.isFinite(unappliedCents) || unappliedCents < 0) {
    throw new Error("Unapplied amount cannot be negative.");
  }

  const allocated = allocationAmountsCents.reduce((sum, amount) => sum + amount, 0);
  if (allocated > paymentAmountCents) {
    throw new Error("Payment allocations exceed the payment amount.");
  }
  if (allocated + unappliedCents !== paymentAmountCents) {
    throw new Error("Payment allocations and unapplied amount must reconcile to the payment amount.");
  }

  return { allocatedCents: allocated, unappliedCents };
}

export async function postInsurancePaymentWorkflow(
  repo: PaymentRepository,
  input: {
    claimId: string;
    amountCents: number;
    allocations: Array<{ claimId: string; claimLineId?: string | null; amountCents: number }>;
    unappliedCents: number;
    traceNumber?: string;
    paymentMethod?: "eft" | "ach" | "check" | "manual";
  },
): Promise<WorkflowResult<{ payment: PaymentRow; status: string; allocatedCents: number }>> {
  const claim = await repo.getClaim(input.claimId);
  if (!claim) return failure("claim_not_found", "Claim not found.");

  let reconciliation: { allocatedCents: number; unappliedCents: number };
  try {
    reconciliation = validateAllocation(
      input.amountCents,
      input.allocations.map((allocation) => allocation.amountCents),
      input.unappliedCents,
    );
  } catch (error) {
    return blocked(
      "payment_reconciliation_failed",
      error instanceof Error ? error.message : "Payment does not reconcile.",
    );
  }

  try {
    const payment = await repo.createPayment({
      client_id: claim.client_id || null,
      payer_id: claim.payer_id || null,
      payment_source: "insurance",
      payment_method: input.paymentMethod || "eft",
      payment_status: "pending",
      payment_date: new Date().toISOString().slice(0, 10),
      amount_cents: input.amountCents,
      trace_number: input.traceNumber || null,
      notes: "Synthetic Therassistant demo payment",
    });

    for (const allocation of input.allocations) {
      if (allocation.amountCents === 0) continue;
      await repo.createPaymentAllocation({
        payment_id: payment.id,
        client_id: claim.client_id || null,
        claim_id: allocation.claimId,
        claim_line_id: allocation.claimLineId || null,
        amount_cents: allocation.amountCents,
      });
    }

    const status = reconciliation.allocatedCents === 0
      ? "unapplied"
      : reconciliation.unappliedCents === 0
        ? "posted"
        : "partially_applied";

    const updated = await repo.updatePayment(payment.id, {
      payment_status: status,
      posted_at: reconciliation.allocatedCents > 0 ? new Date().toISOString() : null,
    });

    return success({ payment: updated, status, allocatedCents: reconciliation.allocatedCents });
  } catch (error) {
    return failure(
      "payment_post_failed",
      error instanceof Error ? error.message : "Unable to post insurance payment.",
    );
  }
}

export async function postDemoEraWorkflow(
  repo: PaymentRepository,
  input: {
    claimId: string;
    paidAmountCents: number;
    adjustmentAmountCents: number;
    patientResponsibilityCents?: number;
    traceNumber?: string;
    carcCode?: string;
  },
): Promise<WorkflowResult<{ eraFileId: string; paymentId: string | null; claimStatus: string }>> {
  const claim = await repo.getClaim(input.claimId);
  if (!claim) return failure("claim_not_found", "Claim not found.");

  const totalChargeCents = Number(claim.total_charge_cents ?? 0);
  const patientResponsibilityCents = Number(input.patientResponsibilityCents ?? 0);
  if (input.paidAmountCents < 0 || input.adjustmentAmountCents < 0 || patientResponsibilityCents < 0) {
    return blocked("negative_adjudication", "ERA payment, adjustment, and patient responsibility amounts cannot be negative.");
  }
  if (input.paidAmountCents + input.adjustmentAmountCents + patientResponsibilityCents > totalChargeCents) {
    return blocked("era_overage", "ERA payment, adjustment, and patient responsibility exceed the claim charge.");
  }

  try {
    const eraFile = await repo.createEraFile({
      payer_id: claim.payer_id || null,
      file_name: `demo-era-${String(claim.patient_control_number || claim.id)}.835`,
      check_or_trace_number: input.traceNumber || `ERA-${Date.now()}`,
      payment_amount_cents: input.paidAmountCents,
      status: "uploaded",
      raw_metadata: { demo: true, claimId: claim.id, patientResponsibilityCents },
    });

    const eraClaim = await repo.createEraClaim({
      era_file_id: eraFile.id,
      patient_control_number: claim.patient_control_number || null,
      client_id: claim.client_id || null,
      claim_id: claim.id,
      charge_amount_cents: totalChargeCents,
      paid_amount_cents: input.paidAmountCents,
      status: "matched",
      raw_data: { demo: true, patientResponsibilityCents },
    });

    await repo.createEraMatch({
      era_claim_id: eraClaim.id,
      claim_id: claim.id,
      match_status: "matched",
      confidence: 1,
    });

    let paymentId: string | null = null;
    if (input.paidAmountCents > 0) {
      const paymentResult = await postInsurancePaymentWorkflow(repo, {
        claimId: claim.id,
        amountCents: input.paidAmountCents,
        allocations: [{ claimId: claim.id, amountCents: input.paidAmountCents }],
        unappliedCents: 0,
        traceNumber: input.traceNumber,
        paymentMethod: "eft",
      });
      if (!paymentResult.ok) return paymentResult;
      paymentId = paymentResult.value.payment.id;
    }

    if (input.adjustmentAmountCents > 0) {
      const adjustment = await repo.createAdjustment({
        client_id: claim.client_id || null,
        claim_id: claim.id,
        payer_id: claim.payer_id || null,
        adjustment_type: "contractual",
        adjustment_status: "posted",
        adjustment_date: new Date().toISOString().slice(0, 10),
        amount_cents: input.adjustmentAmountCents,
        reason: "Contractual adjustment from synthetic ERA",
        carc_code: input.carcCode || "45",
        posted_at: new Date().toISOString(),
      });

      await repo.createAdjustmentAllocation({
        adjustment_id: adjustment.id,
        client_id: claim.client_id || null,
        claim_id: claim.id,
        amount_cents: input.adjustmentAmountCents,
      });
    }

    const openBalance = totalChargeCents - input.paidAmountCents - input.adjustmentAmountCents;
    const responsibility = partitionAdjudicatedBalance(openBalance, patientResponsibilityCents);
    const insuranceRemainder = responsibility.insuranceResponsibilityCents;
    const claimStatus = openBalance === 0
      ? "paid"
      : patientResponsibilityCents > 0 && insuranceRemainder === 0
        ? "patient_responsibility"
        : "partially_paid";
    const currentMetadata = claim.metadata && typeof claim.metadata === "object" && !Array.isArray(claim.metadata)
      ? claim.metadata
      : {};
    await repo.updateClaim(claim.id, {
      claim_status: claimStatus,
      metadata: {
        ...currentMetadata,
        patient_responsibility_cents: responsibility.patientResponsibilityCents,
        insurance_responsibility_cents: responsibility.insuranceResponsibilityCents,
      },
      ...(claimStatus === "paid" ? { paid_at: new Date().toISOString() } : { paid_at: null }),
    });

    await repo.updateEraFile(eraFile.id, { status: "posted" });

    return success({ eraFileId: eraFile.id, paymentId, claimStatus });
  } catch (error) {
    return failure(
      "era_post_failed",
      error instanceof Error ? error.message : "Unable to post synthetic ERA.",
    );
  }
}

export async function createDenialFromAdjudicationWorkflow(
  repo: PaymentRepository,
  input: {
    claimId: string;
    amountCents: number;
    carcCode?: string;
    rarcCode?: string;
    category: string;
    reason: string;
    workability?: string;
  },
): Promise<WorkflowResult<{ denial: PaymentRow; claimStatus: string }>> {
  const claim = await repo.getClaim(input.claimId);
  if (!claim) return failure("claim_not_found", "Claim not found.");
  if (input.amountCents < 0) return blocked("invalid_denial_amount", "Denial amount cannot be negative.");

  try {
    const denial = await repo.createDenial({
      claim_id: claim.id,
      client_id: claim.client_id || null,
      payer_id: claim.payer_id || null,
      denial_date: new Date().toISOString().slice(0, 10),
      denial_status: "new",
      denial_category: input.category || "other",
      workability: input.workability || "needs_review",
      carc_code: input.carcCode || null,
      rarc_code: input.rarcCode || null,
      amount_cents: input.amountCents,
      reason: input.reason,
    });

    await repo.updateClaim(claim.id, { claim_status: "denied" });
    await repo.upsertWorkItem({
      workqueue_type: "denial_followup",
      source_object_type: "denial",
      source_object_id: denial.id,
      title: "Denial requires follow-up",
      description: `${input.carcCode ? `CARC ${input.carcCode}. ` : ""}${input.reason}`.trim(),
      priority: "high",
      workqueue_status: "open",
    });

    return success({ denial, claimStatus: "denied" });
  } catch (error) {
    return failure(
      "denial_creation_failed",
      error instanceof Error ? error.message : "Unable to create denial follow-up.",
    );
  }
}
