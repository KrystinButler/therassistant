export type EligibilityStatus = "active" | "inactive" | "unable_to_verify";

export type Synthetic271 = {
  demo: true;
  transaction: "271";
  member_id: string;
  outcome: EligibilityStatus;
  benefits?: {
    copay_cents: number;
    coinsurance_percent: number;
    deductible_cents: number;
    deductible_remaining_cents: number;
    out_of_pocket_cents: number;
    out_of_pocket_remaining_cents: number;
    network_status: "in_network" | "out_of_network" | "unknown";
    authorization_required: boolean;
  };
};

export function syntheticEligibilityStatus(memberId: string): EligibilityStatus {
  const normalized = memberId.trim();
  if (normalized.endsWith("0")) return "inactive";
  if (normalized.endsWith("9")) return "unable_to_verify";
  return "active";
}

export function buildSyntheticEligibilityResponse(
  memberId: string,
  status: EligibilityStatus = syntheticEligibilityStatus(memberId),
): Synthetic271 {
  const base: Synthetic271 = {
    demo: true,
    transaction: "271",
    member_id: memberId.trim(),
    outcome: status,
  };

  if (status !== "active") return base;

  return {
    ...base,
    benefits: {
      copay_cents: 2000,
      coinsurance_percent: 20,
      deductible_cents: 150000,
      deductible_remaining_cents: 75000,
      out_of_pocket_cents: 500000,
      out_of_pocket_remaining_cents: 325000,
      network_status: "in_network",
      authorization_required: false,
    },
  };
}

export function parseEligibilityBenefits(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const benefits = value.benefits && typeof value.benefits === "object"
    ? (value.benefits as Record<string, unknown>)
    : null;

  return {
    copayCents: benefits ? Number(benefits.copay_cents ?? 0) : null,
    coinsurancePercent: benefits ? Number(benefits.coinsurance_percent ?? 0) : null,
    deductibleCents: benefits ? Number(benefits.deductible_cents ?? 0) : null,
    deductibleRemainingCents: benefits ? Number(benefits.deductible_remaining_cents ?? 0) : null,
    outOfPocketCents: benefits ? Number(benefits.out_of_pocket_cents ?? 0) : null,
    outOfPocketRemainingCents: benefits ? Number(benefits.out_of_pocket_remaining_cents ?? 0) : null,
    networkStatus: benefits ? String(benefits.network_status ?? "unknown") : "unknown",
    authorizationRequired: benefits ? benefits.authorization_required === true : false,
  };
}
