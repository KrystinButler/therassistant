import {
  blocked,
  failure,
  success,
  type WorkflowResult,
} from "../shared/workflow-result";
import {
  claimAdjustmentTotalCents,
  claimContractualAdjustmentCents,
  claimPatientResponsibilityCents,
  parse835,
  unsupportedAdjustmentGroups,
  type Era835Claim,
} from "./era-835";

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

export type EraImportRepository = PaymentRepository & {
  postEraPaymentReceipt(input: {
    payerId: string;
    amountCents: number;
    method: string;
    paymentDate: string | null;
    traceNumber: string;
    notes: string;
  }): Promise<PaymentRow>;
  allocatePayment(paymentId: string, claimId: string, amountCents: number): Promise<Record<string, unknown>>;
  postContractualAdjustment(input: {
    claimId: string;
    amountCents: number;
    adjustmentDate: string | null;
    reason: string;
    carcCode?: string | null;
  }): Promise<PaymentRow>;
  findClaimsByPatientControlNumber(patientControlNumber: string): Promise<PaymentRow[]>;
  getClaimLines(claimId: string): Promise<PaymentRow[]>;
  getEraFileByTrace(traceNumber: string): Promise<PaymentRow | null>;
  getExpectedEraPayerIdentifier(payerId: string): Promise<string | null>;
  createEraServiceLine(values: Record<string, unknown>): Promise<PaymentRow>;
  updateEraClaim(eraClaimId: string, values: Record<string, unknown>): Promise<PaymentRow>;
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
      notes: "Insurance payment",
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

function paymentMethodFrom835(code: string) {
  const normalized = code.trim().toUpperCase();
  if (normalized === "ACH") return "ach";
  if (normalized === "CHK") return "check";
  return "other";
}

function firstAdjustment(claim: Era835Claim) {
  return [
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ][0] ?? null;
}

function hasNegativeAdjustment(claim: Era835Claim) {
  return [
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ].some((row) => row.amountCents < 0);
}

const AUTO_POST_CLAIM_STATUS_CODES = new Set(["1", "2", "3", "19", "20", "21"]);

export async function import835Workflow(
  repo: EraImportRepository,
  input: { rawText: string; fileName: string },
): Promise<WorkflowResult<{
  eraFileId: string;
  claimCount: number;
  matchedCount: number;
  postedCount: number;
  exceptionCount: number;
  paymentId: string | null;
}>> {
  let parsed: ReturnType<typeof parse835>;
  try {
    parsed = parse835(input.rawText);
  } catch (error) {
    return blocked(
      "invalid_835",
      error instanceof Error ? error.message : "Unable to parse the 835 file.",
    );
  }

  const duplicate = await repo.getEraFileByTrace(parsed.traceNumber);
  if (duplicate) {
    return blocked(
      "duplicate_835",
      `An ERA with trace ${parsed.traceNumber} has already been imported.`,
    );
  }

  const importedAt = new Date().toISOString();
  let eraFile: PaymentRow;
  try {
    eraFile = await repo.createEraFile({
      payer_id: null,
      file_name: input.fileName.trim() || `835-${parsed.traceNumber}.txt`,
      check_or_trace_number: parsed.traceNumber,
      payment_amount_cents: parsed.paymentAmountCents,
      status: "uploaded",
      raw_metadata: {
        source: "835_import",
        transaction_control_number: parsed.transactionControlNumber,
        payer_name: parsed.payerName,
        payer_identifier_qualifier: parsed.payerIdentifierQualifier,
        payer_identifier: parsed.payerIdentifier,
        payee_name: parsed.payeeName,
        payment_method_code: parsed.paymentMethodCode,
        payment_date: parsed.paymentDate,
        provider_level_adjustments: parsed.providerLevelAdjustments,
        imported_at: importedAt,
        raw_x12: input.rawText,
      },
    });
  } catch (error) {
    return failure(
      "era_file_create_failed",
      error instanceof Error ? error.message : "Unable to create ERA import record.",
    );
  }

  type Prepared = {
    parsedClaim: Era835Claim;
    claim: PaymentRow;
    eraClaim: PaymentRow;
    contractualCents: number;
    patientResponsibilityCents: number;
  };
  type PreparedDenial = {
    parsedClaim: Era835Claim;
    claim: PaymentRow;
    eraClaim: PaymentRow;
    carcCode: string | undefined;
    rarcCode: string | undefined;
    reason: string;
  };

  const prepared: Prepared[] = [];
  const preparedDenials: PreparedDenial[] = [];
  const matchedPayerIds = new Set<string>();
  const verifiedPayerIds = new Set<string>();
  const expectedEraIds = new Map<string, string | null>();
  let payerIdentityBlocked = false;
  let matchedCount = 0;
  let exceptionCount = 0;
  let postedCount = 0;

  async function routeEraIssue(
    title: string,
    description: string,
    sourceObjectType: "era" | "claim",
    sourceObjectId: string,
    workqueueType: "unmatched_era" | "payment_posting_issue" = "payment_posting_issue",
  ) {
    exceptionCount += 1;
    await repo.upsertWorkItem({
      workqueue_type: workqueueType,
      source_object_type: sourceObjectType,
      source_object_id: sourceObjectId,
      title,
      description,
      priority: "high",
      workqueue_status: "open",
    });
  }

  async function verifyEraPayerIdentity(claim: PaymentRow, controlNumber: string) {
    const payerId = String(claim.payer_id ?? "");
    if (!payerId) {
      payerIdentityBlocked = true;
      await routeEraIssue(
        "835 matched claim has no payer",
        `${controlNumber}: the matched internal claim has no payer, so the remittance source cannot be verified.`,
        "claim",
        claim.id,
      );
      return false;
    }

    let expected = expectedEraIds.get(payerId);
    if (expected === undefined) {
      expected = await repo.getExpectedEraPayerIdentifier(payerId);
      expectedEraIds.set(payerId, expected);
    }

    const inbound = parsed.payerIdentifier.trim().toUpperCase();
    const configured = String(expected ?? "").trim().toUpperCase();

    if (!configured) {
      payerIdentityBlocked = true;
      await routeEraIssue(
        "ERA payer identifier is not configured",
        `${controlNumber}: configure the inbound ERA payer ID for this payer before auto-posting remittances.`,
        "claim",
        claim.id,
      );
      return false;
    }

    if (!inbound) {
      payerIdentityBlocked = true;
      await routeEraIssue(
        "835 payer identifier is missing",
        `${controlNumber}: the 835 N1*PR segment does not contain N104, so THERASSISTANT cannot verify the remittance payer.`,
        "claim",
        claim.id,
      );
      return false;
    }

    if (inbound !== configured) {
      payerIdentityBlocked = true;
      await routeEraIssue(
        "835 payer identifier does not match",
        `${controlNumber}: inbound ERA payer ID ${parsed.payerIdentifier} does not match the configured payer ID. Financial posting was blocked.`,
        "claim",
        claim.id,
      );
      return false;
    }

    verifiedPayerIds.add(payerId);
    return true;
  }

  if (parsed.providerLevelAdjustments.length) {
    await routeEraIssue(
      "835 provider-level adjustment requires review",
      `ERA ${parsed.traceNumber} contains PLB provider adjustments. Review and post the PLB separately before reconciling the deposit.`,
      "era",
      eraFile.id,
    );
  }

  for (const parsedClaim of parsed.claims) {
    const matches = await repo.findClaimsByPatientControlNumber(parsedClaim.patientControlNumber);
    const matchStatus = matches.length === 1
      ? "matched"
      : matches.length > 1
        ? "ambiguous"
        : "unmatched";
    const claim = matches.length === 1 ? matches[0] : null;

    const eraClaim = await repo.createEraClaim({
      era_file_id: eraFile.id,
      payer_claim_number: parsedClaim.payerClaimNumber || null,
      patient_control_number: parsedClaim.patientControlNumber || null,
      client_id: claim?.client_id || null,
      claim_id: claim?.id || null,
      charge_amount_cents: parsedClaim.totalChargeCents,
      paid_amount_cents: parsedClaim.paidAmountCents,
      status: matchStatus,
      raw_data: {
        claim_status_code: parsedClaim.claimStatusCode,
        patient_responsibility_cents: parsedClaim.patientResponsibilityCents,
        patient_last_name: parsedClaim.patientLastName,
        patient_first_name: parsedClaim.patientFirstName,
        adjustments: parsedClaim.adjustments,
        remark_codes: parsedClaim.remarkCodes,
        raw_segments: parsedClaim.rawSegments,
      },
    });

    await repo.createEraMatch({
      era_claim_id: eraClaim.id,
      claim_id: claim?.id || null,
      match_status: matchStatus,
      confidence: claim ? 1 : 0,
    });

    if (!claim) {
      await routeEraIssue(
        matches.length > 1 ? "Ambiguous 835 claim match" : "Unmatched 835 claim",
        matches.length > 1
          ? `Multiple claims match patient control number ${parsedClaim.patientControlNumber}.`
          : `No internal claim matches patient control number ${parsedClaim.patientControlNumber}.`,
        "era",
        eraFile.id,
        "unmatched_era",
      );
      continue;
    }

    matchedCount += 1;
    if (claim.payer_id) matchedPayerIds.add(String(claim.payer_id));

    if (!(await verifyEraPayerIdentity(claim, parsedClaim.patientControlNumber))) {
      continue;
    }

    const claimLines = await repo.getClaimLines(claim.id);
    for (const service of parsedClaim.serviceLines) {
      const matchingLines = claimLines.filter((line) =>
        String(line.cpt_code ?? "") === service.cptCode &&
        (!service.serviceDate || String(line.service_date ?? "") === service.serviceDate),
      );
      await repo.createEraServiceLine({
        era_claim_id: eraClaim.id,
        claim_line_id: matchingLines.length === 1 ? matchingLines[0].id : null,
        service_date: service.serviceDate,
        cpt_code: service.cptCode || null,
        charge_amount_cents: service.chargeAmountCents,
        paid_amount_cents: service.paidAmountCents,
        raw_data: {
          adjustments: service.adjustments,
          raw_segments: service.rawSegments,
          match_count: matchingLines.length,
        },
      });
    }

    if (Number(claim.total_charge_cents ?? 0) !== parsedClaim.totalChargeCents) {
      await routeEraIssue(
        "835 claim charge does not match",
        `${parsedClaim.patientControlNumber}: ERA charge ${parsedClaim.totalChargeCents} cents does not match internal claim charge ${Number(claim.total_charge_cents ?? 0)} cents.`,
        "claim",
        claim.id,
      );
      continue;
    }

    if (hasNegativeAdjustment(parsedClaim)) {
      await routeEraIssue(
        "835 reversal/negative adjustment requires review",
        `${parsedClaim.patientControlNumber} contains a negative CAS adjustment. Do not auto-post until the reversal or recoupment is reviewed.`,
        "claim",
        claim.id,
      );
      continue;
    }

    const adjustments = claimAdjustmentTotalCents(parsedClaim);
    if (parsedClaim.paidAmountCents + adjustments !== parsedClaim.totalChargeCents) {
      await routeEraIssue(
        "835 claim does not reconcile",
        `${parsedClaim.patientControlNumber}: paid plus CAS adjustments does not equal the ERA claim charge.`,
        "claim",
        claim.id,
      );
      continue;
    }

    const unsupported = unsupportedAdjustmentGroups(parsedClaim);
    if (unsupported.length) {
      await routeEraIssue(
        "835 adjustment group requires review",
        `${parsedClaim.patientControlNumber} contains unsupported CAS group(s): ${unsupported.join(", ")}. THERASSISTANT will not auto-write off these adjustments.`,
        "claim",
        claim.id,
      );
      continue;
    }

    if (parsedClaim.claimStatusCode === "4") {
      if (parsedClaim.paidAmountCents > 0) {
        await routeEraIssue(
          "Denied 835 claim includes payment",
          `${parsedClaim.patientControlNumber} has CLP status 4 but also includes a payment. Review before posting.`,
          "claim",
          claim.id,
        );
        continue;
      }
      const adjustment = firstAdjustment(parsedClaim);
      preparedDenials.push({
        parsedClaim,
        claim,
        eraClaim,
        carcCode: adjustment?.reasonCode,
        rarcCode: parsedClaim.remarkCodes[0],
        reason: [
          adjustment ? `${adjustment.groupCode}-${adjustment.reasonCode}` : "835 denial",
          ...parsedClaim.remarkCodes,
        ].join(" · "),
      });
      continue;
    }

    if (!AUTO_POST_CLAIM_STATUS_CODES.has(parsedClaim.claimStatusCode)) {
      await routeEraIssue(
        "835 claim status requires review",
        `${parsedClaim.patientControlNumber} has CLP status ${parsedClaim.claimStatusCode}, which is not auto-posted.`,
        "claim",
        claim.id,
      );
      continue;
    }

    prepared.push({
      parsedClaim,
      claim,
      eraClaim,
      contractualCents: claimContractualAdjustmentCents(parsedClaim),
      patientResponsibilityCents: claimPatientResponsibilityCents(parsedClaim),
    });
  }

  const parsedPaidTotal = parsed.claims.reduce((sum, claim) => sum + claim.paidAmountCents, 0);
  if (!parsed.providerLevelAdjustments.length && parsedPaidTotal !== parsed.paymentAmountCents) {
    await routeEraIssue(
      "835 payment does not reconcile to claim payments",
      `BPR payment is ${parsed.paymentAmountCents} cents but CLP paid amounts total ${parsedPaidTotal} cents.`,
      "era",
      eraFile.id,
    );
  }

  if (matchedPayerIds.size === 1) {
    await repo.updateEraFile(eraFile.id, { payer_id: [...matchedPayerIds][0] });
  } else if (matchedPayerIds.size > 1) {
    await routeEraIssue(
      "835 matched claims span multiple payers",
      "Matched claims reference more than one internal payer. Review payer mapping before posting.",
      "era",
      eraFile.id,
    );
  }

  const financialPostingAllowed =
    !payerIdentityBlocked &&
    matchedPayerIds.size === 1 &&
    verifiedPayerIds.size === 1;

  let paymentId: string | null = null;
  if (parsed.paymentAmountCents > 0) {
    if (payerIdentityBlocked) {
      await routeEraIssue(
        "835 payer identity verification failed",
        "The ERA payment was not posted because one or more matched claims failed inbound payer identity verification.",
        "era",
        eraFile.id,
      );
    } else if (!financialPostingAllowed) {
      await routeEraIssue(
        "835 payment payer cannot be determined",
        "The ERA payment cannot be posted to the ledger until all matched claims resolve to one internal payer.",
        "era",
        eraFile.id,
      );
    } else {
      const payment = await repo.postEraPaymentReceipt({
        payerId: [...verifiedPayerIds][0],
        amountCents: parsed.paymentAmountCents,
        method: paymentMethodFrom835(parsed.paymentMethodCode),
        paymentDate: parsed.paymentDate,
        traceNumber: parsed.traceNumber,
        notes: `Imported from 835 ${input.fileName.trim() || parsed.traceNumber}`,
      });
      paymentId = payment.id;

      let allocatedCents = 0;
      for (const item of prepared) {
        if (item.parsedClaim.paidAmountCents <= 0) continue;
        const result = await repo.allocatePayment(
          payment.id,
          item.claim.id,
          item.parsedClaim.paidAmountCents,
        );
        allocatedCents += Number(result.allocation_cents ?? item.parsedClaim.paidAmountCents);
      }

      if (allocatedCents !== parsed.paymentAmountCents) {
        await routeEraIssue(
          "835 payment has unapplied balance",
          `${parsed.paymentAmountCents - allocatedCents} cents from trace ${parsed.traceNumber} remains unapplied because one or more ERA claims require review.`,
          "era",
          eraFile.id,
        );
      }
    }
  }

  if (financialPostingAllowed) {
  for (const item of prepared) {
    if (item.contractualCents > 0) {
      await repo.postContractualAdjustment({
        claimId: item.claim.id,
        amountCents: item.contractualCents,
        adjustmentDate: parsed.paymentDate,
        reason: "Contractual adjustment from imported 835",
        carcCode: [
          ...item.parsedClaim.adjustments,
          ...item.parsedClaim.serviceLines.flatMap((line) => line.adjustments),
        ].find((row) => row.groupCode === "CO")?.reasonCode || null,
      });
    }

    const remaining = Math.max(
      0,
      item.parsedClaim.totalChargeCents -
        item.parsedClaim.paidAmountCents -
        item.contractualCents,
    );
    const patientResponsibility = Math.min(
      remaining,
      item.patientResponsibilityCents,
    );
    const insuranceResponsibility = Math.max(0, remaining - patientResponsibility);
    const claimStatus = remaining === 0
      ? "paid"
      : patientResponsibility > 0 && insuranceResponsibility === 0
        ? "patient_responsibility"
        : "partially_paid";
    const currentMetadata =
      item.claim.metadata &&
      typeof item.claim.metadata === "object" &&
      !Array.isArray(item.claim.metadata)
        ? item.claim.metadata
        : {};

    await repo.updateClaim(item.claim.id, {
      claim_status: claimStatus,
      payer_claim_number:
        item.parsedClaim.payerClaimNumber || item.claim.payer_claim_number || null,
      metadata: {
        ...currentMetadata,
        patient_responsibility_cents: patientResponsibility,
        insurance_responsibility_cents: insuranceResponsibility,
        last_835_trace_number: parsed.traceNumber,
      },
      ...(claimStatus === "paid" ? { paid_at: new Date().toISOString() } : {}),
    });
    await repo.updateEraClaim(item.eraClaim.id, { status: "posted" });
    postedCount += 1;
  }

  for (const item of preparedDenials) {
    const denial = await createDenialFromAdjudicationWorkflow(repo, {
      claimId: item.claim.id,
      amountCents: item.parsedClaim.totalChargeCents,
      carcCode: item.carcCode,
      rarcCode: item.rarcCode,
      category: "other",
      reason: item.reason,
      workability: "needs_review",
    });
    if (!denial.ok) {
      await routeEraIssue(
        "Unable to post 835 denial",
        denial.message,
        "claim",
        item.claim.id,
      );
      continue;
    }
    await repo.updateClaim(item.claim.id, {
      payer_claim_number:
        item.parsedClaim.payerClaimNumber || item.claim.payer_claim_number || null,
    });
    await repo.updateEraClaim(item.eraClaim.id, { status: "posted" });
    postedCount += 1;
  }
  }

  const finalFileStatus = exceptionCount === 0 && postedCount === parsed.claims.length
    ? "posted"
    : matchedCount === parsed.claims.length
      ? "partially_matched"
      : "partially_matched";
  await repo.updateEraFile(eraFile.id, { status: finalFileStatus });

  return success({
    eraFileId: eraFile.id,
    claimCount: parsed.claims.length,
    matchedCount,
    postedCount,
    exceptionCount,
    paymentId,
  });
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
