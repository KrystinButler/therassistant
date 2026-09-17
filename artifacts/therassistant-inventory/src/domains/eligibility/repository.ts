import { tenantInsert, tenantSelect, type Row } from "../../lib/tenant-data-client";
import {
  buildSyntheticEligibilityResponse,
  parseEligibilityBenefits,
  syntheticEligibilityStatus,
} from "./workflow";

type DataRow = Row & { id: string };

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
