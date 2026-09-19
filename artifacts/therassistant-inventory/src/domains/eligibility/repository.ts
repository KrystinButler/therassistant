import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";
import {
  buildSyntheticEligibilityResponse,
  parseEligibilityBenefits,
  syntheticEligibilityStatus,
} from "./workflow";

type DataRow = Row & { id: string };

export type ManualEligibilityStatus =
  | "active"
  | "inactive"
  | "eligible"
  | "ineligible"
  | "coverage_terminated"
  | "unable_to_verify"
  | "pending"
  | "error";

export type ManualEligibilityInput = {
  patientId: string;
  policyId: string;
  payerId: string;
  serviceDate: string;
  status: ManualEligibilityStatus;
  source: "payer_portal" | "payer_phone" | "clearinghouse_portal" | "other";
  reference?: string;
  copayCents?: number | null;
  coinsurancePercent?: number | null;
  deductibleCents?: number | null;
  deductibleRemainingCents?: number | null;
  outOfPocketCents?: number | null;
  outOfPocketRemainingCents?: number | null;
  networkStatus?: "in_network" | "out_of_network" | "unknown";
  authorizationRequired?: boolean | null;
  notes?: string;
};

export async function getEligibilityHistory(patientId: string) {
  const rows = await tenantSelect<DataRow>("eligibility_checks", {
    client_id: `eq.${patientId}`,
    order: "service_date.desc,created_at.desc",
  });
  return rows.map((row) => ({
    ...row,
    benefits: parseEligibilityBenefits(row.raw_response),
  }));
}

export async function runPatientEligibility(input: {
  patientId: string;
  policyId: string;
  payerId: string;
  memberId: string;
  serviceDate: string;
}) {
  if (!input.patientId) throw new Error("Patient is required.");
  if (!input.policyId) throw new Error("Insurance policy is required.");
  if (!input.payerId) throw new Error("Payer is required.");
  if (!input.memberId.trim()) throw new Error("Member ID is required.");
  if (!input.serviceDate) throw new Error("Service date is required.");

  const status = syntheticEligibilityStatus(input.memberId);
  const raw = buildSyntheticEligibilityResponse(input.memberId, status);

  return tenantInsert<DataRow>("eligibility_checks", {
    client_id: input.patientId,
    insurance_policy_id: input.policyId,
    payer_id: input.payerId,
    service_date: input.serviceDate,
    eligibility_status: status,
    response_source: "synthetic_demo_270_271",
    raw_response: raw,
    notes:
      status === "active"
        ? "Synthetic 270/271 response: active coverage and illustrative benefits."
        : `Synthetic 270/271 response: ${status.replaceAll("_", " ")}.`,
  });
}

function validateOptionalAmount(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return Math.round(value);
}

export async function recordManualEligibility(input: ManualEligibilityInput) {
  if (!input.patientId) throw new Error("Patient is required.");
  if (!input.policyId) throw new Error("Insurance policy is required.");
  if (!input.payerId) throw new Error("Payer is required.");
  if (!input.serviceDate) throw new Error("Service date is required.");

  if (
    input.coinsurancePercent !== null &&
    input.coinsurancePercent !== undefined &&
    (!Number.isFinite(input.coinsurancePercent) ||
      input.coinsurancePercent < 0 ||
      input.coinsurancePercent > 100)
  ) {
    throw new Error("Coinsurance must be between 0 and 100 percent.");
  }

  const policy = (
    await tenantSelect<DataRow>("client_insurance_policies", {
      id: `eq.${input.policyId}`,
      limit: "1",
    })
  )[0];
  if (!policy) throw new Error("Insurance policy was not found.");

  const benefits = {
    copay_cents: validateOptionalAmount(input.copayCents, "Copay"),
    coinsurance_percent:
      input.coinsurancePercent === null || input.coinsurancePercent === undefined
        ? null
        : Number(input.coinsurancePercent),
    deductible_cents: validateOptionalAmount(input.deductibleCents, "Deductible"),
    deductible_remaining_cents: validateOptionalAmount(
      input.deductibleRemainingCents,
      "Deductible remaining",
    ),
    out_of_pocket_cents: validateOptionalAmount(
      input.outOfPocketCents,
      "Out-of-pocket maximum",
    ),
    out_of_pocket_remaining_cents: validateOptionalAmount(
      input.outOfPocketRemainingCents,
      "Out-of-pocket remaining",
    ),
    network_status: input.networkStatus ?? "unknown",
    authorization_required:
      typeof input.authorizationRequired === "boolean"
        ? input.authorizationRequired
        : null,
  };

  const result = await tenantInsert<DataRow>("eligibility_checks", {
    client_id: input.patientId,
    insurance_policy_id: input.policyId,
    payer_id: input.payerId,
    service_date: input.serviceDate,
    eligibility_status: input.status,
    response_source: `manual_${input.source}`,
    raw_response: {
      manual: true,
      verified_at: new Date().toISOString(),
      verification_source: input.source,
      reference: input.reference?.trim() || null,
      benefits,
    },
    notes: input.notes?.trim() || null,
  });

  if (typeof input.authorizationRequired === "boolean") {
    const currentMetadata =
      policy.metadata && typeof policy.metadata === "object"
        ? (policy.metadata as Record<string, unknown>)
        : {};
    await tenantUpdate<DataRow>("client_insurance_policies", input.policyId, {
      metadata: {
        ...currentMetadata,
        authorization_required: input.authorizationRequired,
      },
    });
  }

  return result;
}
