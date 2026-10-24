export function isVerifiedEligibilitySource(source: unknown) {
  const value = String(source ?? "").trim().toLowerCase();
  if (!value) return true;
  // Demo/mock transactions prove connectivity, not actual member coverage.
  // Keep them out of readiness and scheduling even if they contain "active".
  return !/(^|[_:-])(demo|synthetic|mock)([_:-]|$)/.test(value);
}

export function parseEligibilityBenefits(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const benefits = value.benefits && typeof value.benefits === "object"
    ? (value.benefits as Record<string, unknown>)
    : null;

  const numberOrNull = (key: string) => {
    if (!benefits) return null;
    const source = benefits[key];
    if (source === null || source === undefined || source === "") return null;
    const parsed = Number(source);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    copayCents: numberOrNull("copay_cents"),
    coinsurancePercent: numberOrNull("coinsurance_percent"),
    deductibleCents: numberOrNull("deductible_cents"),
    deductibleRemainingCents: numberOrNull("deductible_remaining_cents"),
    outOfPocketCents: numberOrNull("out_of_pocket_cents"),
    outOfPocketRemainingCents: numberOrNull("out_of_pocket_remaining_cents"),
    networkStatus: benefits ? String(benefits.network_status ?? "unknown") : "unknown",
    authorizationRequired: benefits ? benefits.authorization_required === true : false,
  };
}
