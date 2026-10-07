export type PayerSourceMode = "automated" | "controlled_fallback";

export type PayerSourceDefinition = {
  key: string;
  label: string;
  mode: PayerSourceMode;
  sourceType: string;
  officialUrl: string;
  baseUrl?: string;
  reason?: string;
  supportingSources: string[];
};

const sources: PayerSourceDefinition[] = [
  {
    key: "cms_medicare",
    label: "Medicare / Medicare Advantage",
    mode: "controlled_fallback",
    sourceType: "CMS_PROVIDER_DIRECTORY",
    officialUrl: "https://www.medicare.gov/care-compare/",
    reason:
      "NPPES and PECOS can support identity and Medicare FFS enrollment, but selected Medicare Advantage plan/network participation requires plan-specific provider-directory evidence.",
    supportingSources: ["nppes", "cms_pecos_ffs"],
  },
  {
    key: "health_first_colorado",
    label: "Health First Colorado",
    mode: "controlled_fallback",
    sourceType: "COLORADO_MEDICAID_PROVIDER_DIRECTORY",
    officialUrl: "https://www.healthfirstcolorado.com/find-doctors/",
    reason:
      "State enrollment and directory evidence must remain separate from participation in a selected RAE/network until a stable machine-readable relationship source is configured.",
    supportingSources: ["nppes"],
  },
  {
    key: "rae_rmhp",
    label: "Rocky Mountain Health Plans — ACC Region 1",
    mode: "controlled_fallback",
    sourceType: "COLORADO_RAE_PROVIDER_DIRECTORY",
    officialUrl: "https://www.uhc.com/communityplan/colorado/plans/medicaid/health-first-colorado",
    reason:
      "Region 1 participation requires current RMHP plan/network directory evidence; Medicaid enrollment alone cannot establish the relationship.",
    supportingSources: ["nppes", "health_first_colorado"],
  },
  {
    key: "rae_northeast_health_partners",
    label: "Northeast Health Partners — ACC Region 2",
    mode: "controlled_fallback",
    sourceType: "COLORADO_RAE_PROVIDER_DIRECTORY",
    officialUrl: "https://www.northeasthealthpartners.org/",
    reason:
      "Region 2 participation requires current payer/network directory evidence before an automated participating result is allowed.",
    supportingSources: ["nppes", "health_first_colorado"],
  },
  {
    key: "rae_ccha",
    label: "Colorado Community Health Alliance — ACC Region 3",
    mode: "controlled_fallback",
    sourceType: "COLORADO_RAE_PROVIDER_DIRECTORY",
    officialUrl: "https://www.cchacares.com/",
    reason:
      "Region 3 participation requires current CCHA network evidence; the application will not infer network participation from state enrollment.",
    supportingSources: ["nppes", "health_first_colorado"],
  },
  {
    key: "rae_colorado_access",
    label: "Colorado Access — ACC Region 4",
    mode: "controlled_fallback",
    sourceType: "COLORADO_RAE_PROVIDER_DIRECTORY",
    officialUrl: "https://www.coaccess.com/members/find-a-provider/",
    reason:
      "Region 4 participation requires current Colorado Access plan/network directory evidence before an automated participating result is allowed.",
    supportingSources: ["nppes", "health_first_colorado"],
  },
  {
    key: "aetna",
    label: "Aetna",
    mode: "controlled_fallback",
    sourceType: "PAYER_PROVIDER_DIRECTORY",
    officialUrl: "https://www.aetna.com/individuals-families/find-a-doctor.html",
    reason:
      "Aetna provider-directory API access can require registered application credentials; without configured plan/network API access the result remains a controlled fallback.",
    supportingSources: ["nppes"],
  },
  {
    key: "anthem",
    label: "Anthem Blue Cross Blue Shield",
    mode: "controlled_fallback",
    sourceType: "FHIR_PROVIDER_DIRECTORY",
    officialUrl: "https://www.anthem.com/find-care/",
    reason:
      "Automated participation requires a verified current Anthem Plan-Net endpoint and selected plan/network identifiers; absent that mapping the official directory is used as fallback.",
    supportingSources: ["nppes"],
  },
  {
    key: "cigna",
    label: "Cigna",
    mode: "automated",
    sourceType: "FHIR_PROVIDER_DIRECTORY",
    officialUrl: "https://developer.cigna.com/docs/service-apis/provider-directory",
    baseUrl: "https://fhir.cigna.com/ProviderDirectory/v1/",
    supportingSources: ["nppes"],
  },
  {
    key: "uhc",
    label: "UnitedHealthcare",
    mode: "controlled_fallback",
    sourceType: "PAYER_PROVIDER_DIRECTORY",
    officialUrl: "https://www.uhc.com/find-a-doctor",
    reason:
      "Selected Colorado plan/network participation requires a current machine-readable UHC directory mapping before the application can return an automated participating result.",
    supportingSources: ["nppes"],
  },
  {
    key: "tricare_west",
    label: "TRICARE West / TriWest",
    mode: "controlled_fallback",
    sourceType: "TRICARE_WEST_PROVIDER_DIRECTORY",
    officialUrl:
      "https://tricare.mil/About/Regions/West-Region/Find-Care/West-Region-Providers",
    reason:
      "TRICARE directs West Region users to the TriWest provider directory; no stable permitted machine-readable selected-network source is configured in the application.",
    supportingSources: ["nppes"],
  },
];

export const TARGET_PAYER_SOURCE_KEYS = sources.map((source) => source.key);

const sourceMap = new Map(sources.map((source) => [source.key, source]));

export function getPayerSource(key: string): PayerSourceDefinition | null {
  return sourceMap.get(key.trim()) ?? null;
}

export function listPayerSources(): PayerSourceDefinition[] {
  return [...sources];
}
