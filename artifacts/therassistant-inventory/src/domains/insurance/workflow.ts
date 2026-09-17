import { tenantInsert, tenantSelect, tenantUpdate, type Row } from "../../lib/tenant-data-client";

export type InsuranceDraft = {
  payerId: string;
  payerPlanId?: string;
  insuranceOrder?: "primary" | "secondary" | "tertiary" | "other";
  status?: "active" | "inactive" | "pending_verification" | "terminated" | "unknown";
  memberId: string;
  groupNumber?: string;
  subscriberName?: string;
  subscriberDob?: string;
  relationshipToSubscriber?: string;
  effectiveDate?: string;
  terminationDate?: string;
  authorizationRequired?: boolean;
};

type PolicyRow = Row & { id: string };

export function buildInsuranceValues(input: InsuranceDraft): Row {
  if (!input.payerId.trim()) throw new Error("Select a payer.");
  if (!input.memberId.trim()) throw new Error("Member ID is required.");

  return {
    payer_id: input.payerId,
    payer_plan_id: input.payerPlanId || null,
    insurance_order: input.insuranceOrder || "primary",
    status: input.status || "pending_verification",
    member_id: input.memberId.trim(),
    group_number: input.groupNumber?.trim() || null,
    subscriber_name: input.subscriberName?.trim() || null,
    subscriber_dob: input.subscriberDob || null,
    relationship_to_subscriber: input.relationshipToSubscriber?.trim() || "self",
    effective_date: input.effectiveDate || null,
    termination_date: input.terminationDate || null,
    metadata: { authorization_required: input.authorizationRequired === true },
  };
}

export function planPrimaryInsuranceUpdates(
  policies: Array<{ id: string; insurance_order?: unknown; status?: unknown }>,
  targetId: string,
) {
  const target = policies.find((row) => row.id === targetId);
  if (!target) throw new Error("Insurance policy not found.");

  const updates: Array<{ id: string; insurance_order: "primary" | "secondary" }> = [];
  for (const policy of policies) {
    if (policy.id !== targetId && policy.insurance_order === "primary" && policy.status !== "terminated") {
      updates.push({ id: policy.id, insurance_order: "secondary" });
    }
  }
  updates.push({ id: targetId, insurance_order: "primary" });
  return updates;
}

export function terminationValues(terminationDate: string): Row {
  if (!terminationDate) throw new Error("Termination date is required.");
  return { status: "terminated", termination_date: terminationDate };
}

export function addInsurancePolicy(patientId: string, input: InsuranceDraft) {
  return tenantInsert<PolicyRow>("client_insurance_policies", {
    client_id: patientId,
    ...buildInsuranceValues(input),
  });
}

export function updateInsurancePolicy(policyId: string, input: InsuranceDraft) {
  return tenantUpdate<PolicyRow>("client_insurance_policies", policyId, buildInsuranceValues(input));
}

export function terminateInsurancePolicy(policyId: string, terminationDate: string) {
  return tenantUpdate<PolicyRow>("client_insurance_policies", policyId, terminationValues(terminationDate));
}

export async function setPrimaryInsurance(patientId: string, policyId: string) {
  const policies = await tenantSelect<PolicyRow>("client_insurance_policies", {
    client_id: `eq.${patientId}`,
    order: "created_at.asc",
  });
  const updates = planPrimaryInsuranceUpdates(policies, policyId);
  const results: PolicyRow[] = [];
  for (const update of updates) {
    results.push(
      await tenantUpdate<PolicyRow>("client_insurance_policies", update.id, {
        insurance_order: update.insurance_order,
      }),
    );
  }
  return results;
}
