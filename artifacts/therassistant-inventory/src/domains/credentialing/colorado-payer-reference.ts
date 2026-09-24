export type ColoradoPayerCategory = "rae" | "mco" | "state" | "medicare" | "commercial" | "military";
export type ColoradoPayerProfile = {
  category: ColoradoPayerCategory;
  region?: number;
  url: string;
  manual?: string;
  enroll?: string;
  note?: string;
};
export type ColoradoReferenceResource = Record<string, unknown> & {
  id: string;
  payer_id: string;
  payer_plan_id: null;
  resource_type: string;
  label: string;
  value: string;
  url: string;
  source_url: string;
  notes: string;
  verification_status: "reference";
  reviewed_at: string;
  review_due_at: string;
};
export const REFERENCE_REVIEWED = "2026-09-24";
export const REFERENCE_DUE = "2026-12-23";
export const COLORADO_RAE_SOURCE = "https://hcpf.colorado.gov/sites/hcpf/files/ACC%20Phase%20III%20RAE%20Fact%20Sheet.pdf";
export const COLORADO_RAE_REGIONS = [
  { region: 1, name: "Rocky Mountain Health Plans" },
  { region: 2, name: "Northeast Health Partners" },
  { region: 3, name: "Colorado Community Health Alliance" },
  { region: 4, name: "Colorado Access" },
] as const;
const PROFILES: Record<string, ColoradoPayerProfile> = {
  "aetna": {
    "category": "commercial",
    "url": "https://www.aetna.com/health-care-professionals.html",
    "manual": "https://www.aetna.com/health-care-professionals/provider-education-manuals/provider-manuals.html"
  },
  "anthem blue cross blue shield": {
    "category": "commercial",
    "url": "https://www.anthem.com/provider"
  },
  "blue cross blue shield": {
    "category": "commercial",
    "url": "https://www.bcbs.com/",
    "note": "Generic BCBS reference: verify the specific carrier and network on the patient's plan. Do not automatically treat it as Anthem."
  },
  "carelon behavioral health": {
    "category": "commercial",
    "url": "https://www.carelonbehavioralhealth.com/providers/resources",
    "manual": "https://www.carelonbehavioralhealth.com/providers/resources/provider-portals",
    "note": "Carelon uses plan-specific or delegated portals; verify the actual contracted product."
  },
  "cigna": {
    "category": "commercial",
    "url": "https://provider.cigna.com/"
  },
  "colorado access": {
    "category": "rae",
    "region": 4,
    "url": "https://www.coaccess.com/providers/resources/",
    "manual": "https://www.coaccess.com/providers/resources/claims/",
    "enroll": "https://www.coaccess.com/providers/resources/contracting/"
  },
  "colorado community health alliance": {
    "category": "rae",
    "region": 3,
    "url": "https://www.cchacares.com/for-providers/provider-resources-training/",
    "note": "The primary-care provider portal is not the same as the behavioral-health claims channel. Confirm the specific benefit."
  },
  "denver health medical plan": {
    "category": "mco",
    "url": "https://www.denverhealthmedicalplan.org/",
    "note": "Denver Health Medicaid Choice is an MCO, not an additional RAE; it operates within the Colorado Access Region 4 service area."
  },
  "health first colorado": {
    "category": "state",
    "url": "https://hcpf.colorado.gov/billing-manuals",
    "enroll": "https://hcpf.colorado.gov/sites/hcpf/files/Provider%20Enrollment%20Manual%20-%201-20-2026.pdf"
  },
  "medicaid": {
    "category": "state",
    "url": "https://hcpf.colorado.gov/billing-manuals",
    "note": "Generic Medicaid reference: confirm whether the billed service belongs to HCPF fee-for-service, a regional organization or an MCO."
  },
  "medicare": {
    "category": "medicare",
    "url": "https://www.cms.gov/medicare/coding-billing/electronic-billing/medicare-fee-for-service-compainion-guides",
    "enroll": "https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/revalidations",
    "note": "Colorado traditional Medicare uses MAC Jurisdiction H (Novitas). Medicare Advantage follows the member's separate plan rules."
  },
  "northeast health partners": {
    "category": "rae",
    "region": 2,
    "url": "https://www.nhprae2.org/"
  },
  "optum": {
    "category": "commercial",
    "url": "https://www.providerexpress.com/",
    "note": "Verify the delegated behavioral-health product and exact payer before filing."
  },
  "rocky mountain health plans": {
    "category": "rae",
    "region": 1,
    "url": "https://www.rmhp.org/"
  },
  "tricare": {
    "category": "military",
    "url": "https://www.tricare.mil/Providers",
    "note": "Check the beneficiary's TRICARE region and product before selecting contractor-specific rules."
  },
  "unitedhealthcare": {
    "category": "commercial",
    "url": "https://www.uhcprovider.com/"
  }
};
export function getColoradoPayerProfile(name: string): ColoradoPayerProfile | null {
  return PROFILES[name.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}
export function listedColoradoPayerNames() { return Object.keys(PROFILES); }
export function coloradoPayerScope(profile: ColoradoPayerProfile | null): string {
  if (!profile) return "Payer requires source review";
  switch (profile.category) {
    case "rae": return "Medicaid RAE · Region " + profile.region;
    case "mco": return "Medicaid managed-care plan";
    case "state": return "Colorado Medicaid / fee-for-service";
    case "medicare": return "Traditional Medicare · Colorado";
    case "military": return "TRICARE · Confirm product";
    default: return "Commercial · Confirm product";
  }
}
export function coloradoPayerRouting(profile: ColoradoPayerProfile | null): string {
  if (!profile) return "A source-reviewed payer reference is not available yet.";
  if (profile.category === "rae")
    return "Check the member's assigned RAE and covered benefit. RAE-administered behavioral-health claims follow the applicable RAE; fee-for-service physical-health claims may follow HCPF.";
  if (profile.category === "mco")
    return "Check Denver Health Medicaid Choice benefits and actual claim administrator. Regional affiliation alone does not establish the claims route.";
  if (profile.category === "state")
    return "Use HCPF rules for fee-for-service Medicaid. Managed behavioral-health benefits may route through the member's assigned RAE.";
  if (profile.category === "medicare")
    return "Use Colorado's Medicare contractor guidance for traditional Medicare, not Medicare Advantage products.";
  return "Check the exact product, network, provider contract and current payer instructions before selecting the claim destination.";
}
export function getColoradoReferenceResources(payerId: string, payerName: string): ColoradoReferenceResource[] {
  const profile = getColoradoPayerProfile(payerName);
  if (!profile || !payerId) return [];
  const key = payerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const create = (type: string, label: string, url: string, notes: string): ColoradoReferenceResource => ({
    id: "co-reference:" + key + ":" + type,
    payer_id: payerId,
    payer_plan_id: null,
    resource_type: type,
    label,
    value: label,
    url,
    source_url: url,
    notes,
    verification_status: "reference",
    reviewed_at: REFERENCE_REVIEWED,
    review_due_at: REFERENCE_DUE,
  });
  const resources: ColoradoReferenceResource[] = [create(
    "portal", "Official provider reference", profile.url, profile.note ?? coloradoPayerRouting(profile)
  )];
  if (profile.manual && profile.manual !== profile.url)
    resources.push(create("claims", "Published billing / claim reference", profile.manual,
      "Consult the current source for the plan and date of service. A source link does not create a code-level billing restriction."));
  if (profile.enroll && profile.enroll !== profile.url)
    resources.push(create("credentialing", "Published enrollment / contracting reference", profile.enroll,
      "Confirm the actual provider approval, group roster and effective date independently."));
  return resources;
}
