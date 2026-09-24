import { evaluateBillingReadiness, type BillingReadinessInput } from "../readiness/evaluate-billing-readiness";
import { blocked, failure, success, type WorkflowResult } from "../shared/workflow-result";

export type BillingRepository = {
  getBillingContext(encounterId: string): Promise<BillingReadinessInput>;
  replaceReadinessChecks(encounterId: string, checks: Array<Record<string, unknown>>): Promise<unknown>;
  upsertWorkItem(values: Record<string, unknown>): Promise<unknown>;
  resolveStaleWorkItems(encounterId: string, activeTypes: string[]): Promise<unknown>;
  updateEncounter(id: string, values: Record<string, unknown>): Promise<unknown>;
  getExistingCharges(encounterId: string): Promise<Array<Record<string, any>>>;
  createCharge(values: Record<string, unknown>): Promise<Record<string, any>>;
  updateCharge(id: string, values: Record<string, unknown>): Promise<Record<string, any>>;
  updateServiceLine(id: string, values: Record<string, unknown>): Promise<unknown>;
};

function queueForCode(code: string) {
  if (code.startsWith("eligibility")) return "eligibility_issue";
  if (code.startsWith("provider_enrollment")) return "credentialing_issue";
  if (code.startsWith("note_") || code.startsWith("diagnosis_")) return "missing_documentation";
  return "charge_validation";
}

type BlockingCheck = {
  code: string;
  label: string;
  message: string;
  blocking: boolean;
};

function groupBlockersByQueue(checks: BlockingCheck[]) {
  const grouped = new Map<string, BlockingCheck[]>();
  for (const check of checks.filter((item) => item.blocking)) {
    const queueType = queueForCode(check.code);
    const group = grouped.get(queueType) ?? [];
    group.push(check);
    grouped.set(queueType, group);
  }
  return grouped;
}

export async function routeEncounterToBillingWorkflow(
  repo: BillingRepository,
  encounterId: string,
): Promise<WorkflowResult<{ encounterId: string }>> {
  try {
    const context = await repo.getBillingContext(encounterId);
    const readiness = evaluateBillingReadiness(context);

    await repo.replaceReadinessChecks(
      encounterId,
      readiness.checks.map((check) => ({
        check_code: check.code,
        check_status: check.status,
        blocking: check.blocking,
        message: check.message,
        action: check.action ?? null,
        evaluated_at: new Date().toISOString(),
      })),
    );

    const groupedBlockers = groupBlockersByQueue(readiness.checks);
    const activeWorkTypes = [...groupedBlockers.keys()];
    await repo.resolveStaleWorkItems(encounterId, activeWorkTypes);

    if (!readiness.ready) {
      await repo.updateEncounter(encounterId, {
        billing_status: "held",
      });

      for (const [workqueueType, checks] of groupedBlockers) {
        const highPriority = checks.some((check) => check.code.startsWith("provider_enrollment"));
        await repo.upsertWorkItem({
          workqueue_type: workqueueType,
          workqueue_status: "open",
          priority: highPriority ? "high" : "normal",
          source_object_type: "encounter",
          source_object_id: encounterId,
          title: checks.length === 1 ? checks[0].label : `${checks.length} billing readiness issues`,
          description: checks.map((check) => `${check.label}: ${check.message}`).join("\n"),
        });
      }

      return blocked(
        "billing_readiness_blocked",
        "Encounter is not ready for billing.",
        readiness.checks.filter((check) => check.blocking).map((check) => check.message),
      );
    }

    await repo.updateEncounter(encounterId, {
      billing_status: "ready",
    });

    return success({ encounterId });
  } catch (error) {
    return failure(
      "billing_readiness_failed",
      error instanceof Error ? error.message : "Unable to evaluate billing readiness.",
    );
  }
}

export async function createChargeFromEncounterWorkflow(
  repo: BillingRepository,
  encounterId: string,
): Promise<WorkflowResult<Array<Record<string, any>>>> {
  const routed = await routeEncounterToBillingWorkflow(repo, encounterId);
  if (!routed.ok && !routed.blocked) return routed;

  try {
    const context = await repo.getBillingContext(encounterId);
    const noteSigned = Boolean(
      context.note && ["signed", "locked"].includes(String(context.note.note_status)),
    );
    if (!noteSigned) {
      return routed.ok
        ? blocked("note_unsigned", "The clinical note must be signed before charge capture.")
        : routed;
    }

    if (!context.serviceLines.length) {
      return routed.ok
        ? blocked("service_line_missing", "A service line is required before charge capture.")
        : routed;
    }

    const readiness = evaluateBillingReadiness(context);
    const billingPath =
      context.billingPath ||
      (context.billingType === "self_pay" ? "private_pay" : "insurance_claim");
    const selfPay = billingPath === "private_pay";
    const programBilling = billingPath === "program_invoice_voucher";
    const insuranceClaim = billingPath === "insurance_claim";
    const blockingMessages = readiness.checks
      .filter((check) => check.blocking)
      .map((check) => check.message);
    const chargeStatus = !readiness.ready
      ? "blocked"
      : selfPay
        ? "patient_responsibility"
        : programBilling
          ? "program_billing"
          : "ready_for_claim";
    const blockReason = readiness.ready ? null : blockingMessages.join(" ");

    const primaryDiagnosis =
      context.diagnoses.find((diagnosis) => diagnosis.is_primary) ?? context.diagnoses[0] ?? null;
    const existing = await repo.getExistingCharges(encounterId);
    const activeByServiceLine = new Map(
      existing
        .filter(
          (charge) =>
            charge.service_line_id &&
            String(charge.charge_status ?? "") !== "voided",
        )
        .map((charge) => [String(charge.service_line_id), charge]),
    );

    const charges: Array<Record<string, any>> = [];
    for (const line of context.serviceLines) {
      const serviceLineId = String(line.id ?? "");
      const cptCode = String(line.cpt_hcpcs_code ?? "").trim();
      if (!serviceLineId || !cptCode) continue;

      const current = activeByServiceLine.get(serviceLineId);
      if (
        current &&
        ["claim_created", "patient_responsibility", "program_billing"].includes(String(current.charge_status ?? ""))
      ) {
        charges.push(current);
        continue;
      }

      const values = {
        service_line_id: serviceLineId,
        encounter_id: encounterId,
        client_id: context.encounter.client_id,
        appointment_id: context.encounter.appointment_id ?? null,
        clinical_note_id: context.note?.id ?? null,
        provider_id: context.encounter.provider_id ?? null,
        payer_id: insuranceClaim ? context.encounter.payer_id ?? null : null,
        funding_source_type: context.fundingSourceType ?? context.encounter.funding_source_type ?? null,
        funding_source_subtype: context.fundingSourceSubtype ?? context.encounter.funding_source_subtype ?? null,
        billing_path: billingPath,
        funding_context: context.fundingContext ?? context.encounter.funding_context ?? {},
        service_date:
          context.note?.service_date ??
          String(context.encounter.started_at ?? "").slice(0, 10),
        cpt_code: cptCode,
        modifier1: line.modifier1 ?? null,
        modifier2: line.modifier2 ?? null,
        units: Number(line.units ?? 1),
        diagnosis_code: primaryDiagnosis?.diagnosis_code ?? null,
        place_of_service: line.place_of_service_code ?? null,
        charge_amount_cents: Number(line.charge_amount_cents ?? 0),
        charge_status: chargeStatus,
        block_reason: blockReason,
      };

      const charge = current
        ? await repo.updateCharge(String(current.id), values)
        : await repo.createCharge(values);
      charges.push(charge);
      await repo.updateServiceLine(serviceLineId, { ready_for_claim: readiness.ready && insuranceClaim });
    }

    if (!charges.length) {
      return routed.ok
        ? blocked("charge_source_missing", "No chargeable service line is available.")
        : routed;
    }

    await repo.updateEncounter(encounterId, {
      billing_status: readiness.ready ? "charged" : "held",
    });

    return success(charges);
  } catch (error) {
    return failure(
      "charge_creation_failed",
      error instanceof Error ? error.message : "Unable to capture charge.",
    );
  }
}
