import { evaluateBillingReadiness, type BillingReadinessInput } from "../readiness/evaluate-billing-readiness";
import { blocked, failure, success, type WorkflowResult } from "../shared/workflow-result";

export type BillingRepository = {
  getBillingContext(encounterId: string): Promise<BillingReadinessInput>;
  replaceReadinessChecks(encounterId: string, checks: Array<Record<string, unknown>>): Promise<unknown>;
  upsertWorkItem(values: Record<string, unknown>): Promise<unknown>;
  updateEncounter(id: string, values: Record<string, unknown>): Promise<unknown>;
  getExistingCharges(encounterId: string): Promise<Array<Record<string, any>>>;
  createCharge(values: Record<string, unknown>): Promise<Record<string, any>>;
  updateServiceLine(id: string, values: Record<string, unknown>): Promise<unknown>;
};

function queueForCode(code: string) {
  if (code.startsWith("eligibility")) return "eligibility_issue";
  if (code.startsWith("authorization")) return "authorization_issue";
  if (code === "provider_enrollment") return "credentialing_issue";
  if (code.startsWith("note_") || code.startsWith("diagnosis_")) return "missing_documentation";
  return "charge_validation";
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

    if (!readiness.ready) {
      await repo.updateEncounter(encounterId, {
        encounter_status: "billing_hold",
        billing_status: "held",
      });

      const blocker = readiness.checks.find((check) => check.blocking)!;
      await repo.upsertWorkItem({
        workqueue_type: queueForCode(blocker.code),
        workqueue_status: "open",
        priority: blocker.code === "provider_enrollment" ? "high" : "normal",
        source_object_type: "encounter",
        source_object_id: encounterId,
        title: blocker.label,
        description: blocker.message,
      });

      return blocked(
        "billing_readiness_blocked",
        "Encounter is not ready for billing.",
        readiness.checks.filter((check) => check.blocking).map((check) => check.message),
      );
    }

    await repo.updateEncounter(encounterId, {
      encounter_status: "ready_for_billing",
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
  if (!routed.ok) return routed;

  try {
    const existing = await repo.getExistingCharges(encounterId);
    if (existing.length) return success(existing);

    const context = await repo.getBillingContext(encounterId);
    const selfPay = context.billingType === "self_pay";
    const primaryDiagnosis =
      context.diagnoses.find((diagnosis) => diagnosis.is_primary) ?? context.diagnoses[0];

    const charges: Array<Record<string, any>> = [];
    for (const line of context.serviceLines) {
      const charge = await repo.createCharge({
        encounter_id: encounterId,
        client_id: context.encounter.client_id,
        appointment_id: context.encounter.appointment_id ?? null,
        clinical_note_id: context.note?.id ?? null,
        provider_id: context.encounter.provider_id ?? null,
        payer_id: context.encounter.payer_id ?? null,
        service_date: context.note?.service_date ?? String(context.encounter.started_at ?? "").slice(0, 10),
        cpt_code: line.cpt_hcpcs_code,
        modifier1: line.modifier1 ?? null,
        modifier2: line.modifier2 ?? null,
        diagnosis_code: primaryDiagnosis?.diagnosis_code ?? null,
        place_of_service: line.place_of_service_code,
        charge_amount_cents: Number(line.charge_amount_cents ?? 0),
        charge_status: selfPay ? "patient_responsibility" : "ready_for_claim",
        block_reason: null,
      });
      charges.push(charge);
      if (line.id) {
        await repo.updateServiceLine(String(line.id), { ready_for_claim: !selfPay });
      }
    }

    await repo.updateEncounter(encounterId, {
      encounter_status: "ready_for_billing",
      billing_status: "charged",
    });

    return success(charges);
  } catch (error) {
    return failure(
      "charge_creation_failed",
      error instanceof Error ? error.message : "Unable to create charge.",
    );
  }
}
