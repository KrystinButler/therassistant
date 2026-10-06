export type DirectoryStatus =
  | "found"
  | "not_found"
  | "multiple_matches"
  | "unable_to_verify"
  | "source_unavailable";

export type DirectoryObservation = {
  sourceKey: string;
  sourceRecordId: string | null;
  directoryStatus: DirectoryStatus;
  providerNpi: string;
  providerName: string | null;
  specialtyText: string | null;
  locationText: string | null;
  networkText: string | null;
  sourceUpdatedAt: string | null;
  checkedAt: string;
  rawResult: unknown;
};

type NppesAddress = {
  address_purpose?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

type NppesTaxonomy = {
  desc?: string;
  code?: string;
  primary?: boolean;
};

type NppesResult = {
  number?: number;
  basic?: {
    first_name?: string;
    last_name?: string;
    organization_name?: string;
    last_updated?: string;
  };
  addresses?: NppesAddress[];
  taxonomies?: NppesTaxonomy[];
};

type NppesResponse = {
  result_count?: number;
  results?: NppesResult[];
};

type CmsEnrollmentRow = Record<string, string | number | boolean | null | undefined>;

const CMS_PECOS_MAIN_DATASET_ID =
  "2457ea29-fc82-48b0-86ec-3b0755de7515";

function formatAddress(address?: NppesAddress) {
  if (!address) return null;
  return [
    address.address_1,
    address.address_2,
    address.city,
    address.state,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(", ") || null;
}

function formatProviderName(result: NppesResult) {
  if (result.basic?.organization_name) {
    return result.basic.organization_name;
  }

  const name = [result.basic?.first_name, result.basic?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
}

function value(row: CmsEnrollmentRow, ...keys: string[]) {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

function formatCmsEnrollmentName(row: CmsEnrollmentRow) {
  const organization = value(row, "ORG_NAME", "ORGANIZATION_NAME");
  if (organization) return organization;

  const name = [
    value(row, "FIRST_NAME", "PROVIDER_FIRST_NAME"),
    value(row, "MDL_NAME", "MIDDLE_NAME", "PROVIDER_MIDDLE_NAME"),
    value(row, "LAST_NAME", "PROVIDER_LAST_NAME"),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
}

function formatCmsEnrollmentLocation(row: CmsEnrollmentRow) {
  const parts = [
    value(row, "LINE_1_ST_ADR", "ADDRESS_LINE_1", "ADDRESS_1"),
    value(row, "LINE_2_ST_ADR", "ADDRESS_LINE_2", "ADDRESS_2"),
    value(row, "CITY_NAME", "CITY"),
    value(row, "STATE_CD", "STATE"),
    value(row, "ZIP_CD", "ZIP", "POSTAL_CODE"),
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : null;
}

export async function lookupNppesProvider(
  npi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectoryObservation> {
  const checkedAt = new Date().toISOString();
  const normalizedNpi = npi.trim();

  if (!/^\d{10}$/.test(normalizedNpi)) {
    return {
      sourceKey: "nppes",
      sourceRecordId: null,
      directoryStatus: "unable_to_verify",
      providerNpi: normalizedNpi,
      providerName: null,
      specialtyText: null,
      locationText: null,
      networkText: null,
      sourceUpdatedAt: null,
      checkedAt,
      rawResult: { error: "NPI must contain exactly 10 digits." },
    };
  }

  const url = new URL("https://npiregistry.cms.hhs.gov/api/");
  url.searchParams.set("version", "2.1");
  url.searchParams.set("number", normalizedNpi);

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        sourceKey: "nppes",
        sourceRecordId: null,
        directoryStatus: "source_unavailable",
        providerNpi: normalizedNpi,
        providerName: null,
        specialtyText: null,
        locationText: null,
        networkText: null,
        sourceUpdatedAt: null,
        checkedAt,
        rawResult: { httpStatus: response.status },
      };
    }

    const body = (await response.json()) as NppesResponse;
    const exactMatches = (body.results ?? []).filter(
      (result) => String(result.number ?? "") === normalizedNpi,
    );

    if (exactMatches.length === 0) {
      return {
        sourceKey: "nppes",
        sourceRecordId: normalizedNpi,
        directoryStatus: "not_found",
        providerNpi: normalizedNpi,
        providerName: null,
        specialtyText: null,
        locationText: null,
        networkText: null,
        sourceUpdatedAt: null,
        checkedAt,
        rawResult: body,
      };
    }

    const result = exactMatches[0];
    const practiceAddress =
      result.addresses?.find((address) => address.address_purpose === "LOCATION") ??
      result.addresses?.[0];
    const primaryTaxonomy =
      result.taxonomies?.find((taxonomy) => taxonomy.primary) ?? result.taxonomies?.[0];

    return {
      sourceKey: "nppes",
      sourceRecordId: normalizedNpi,
      directoryStatus: exactMatches.length > 1 ? "multiple_matches" : "found",
      providerNpi: normalizedNpi,
      providerName: formatProviderName(result),
      specialtyText: primaryTaxonomy?.desc ?? primaryTaxonomy?.code ?? null,
      locationText: formatAddress(practiceAddress),
      networkText: null,
      sourceUpdatedAt: result.basic?.last_updated ?? null,
      checkedAt,
      rawResult: body,
    };
  } catch (error) {
    return {
      sourceKey: "nppes",
      sourceRecordId: null,
      directoryStatus: "source_unavailable",
      providerNpi: normalizedNpi,
      providerName: null,
      specialtyText: null,
      locationText: null,
      networkText: null,
      sourceUpdatedAt: null,
      checkedAt,
      rawResult: {
        error: error instanceof Error ? error.message : "NPPES lookup failed",
      },
    };
  }
}

export async function lookupCmsMedicareEnrollment(
  npi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectoryObservation> {
  const checkedAt = new Date().toISOString();
  const normalizedNpi = npi.trim();

  if (!/^\d{10}$/.test(normalizedNpi)) {
    return {
      sourceKey: "cms_pecos_ffs",
      sourceRecordId: null,
      directoryStatus: "unable_to_verify",
      providerNpi: normalizedNpi,
      providerName: null,
      specialtyText: null,
      locationText: null,
      networkText: null,
      sourceUpdatedAt: null,
      checkedAt,
      rawResult: { error: "NPI must contain exactly 10 digits." },
    };
  }

  const url = new URL(
    `https://data.cms.gov/data-api/v1/dataset/${CMS_PECOS_MAIN_DATASET_ID}/data`,
  );
  url.searchParams.set("filter[NPI]", normalizedNpi);
  url.searchParams.set("size", "50");

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        sourceKey: "cms_pecos_ffs",
        sourceRecordId: null,
        directoryStatus: "source_unavailable",
        providerNpi: normalizedNpi,
        providerName: null,
        specialtyText: null,
        locationText: null,
        networkText: null,
        sourceUpdatedAt: null,
        checkedAt,
        rawResult: { httpStatus: response.status, datasetId: CMS_PECOS_MAIN_DATASET_ID },
      };
    }

    const body = (await response.json()) as CmsEnrollmentRow[];
    const exactMatches = Array.isArray(body)
      ? body.filter((row) => value(row, "NPI") === normalizedNpi)
      : [];

    if (exactMatches.length === 0) {
      return {
        sourceKey: "cms_pecos_ffs",
        sourceRecordId: normalizedNpi,
        directoryStatus: "not_found",
        providerNpi: normalizedNpi,
        providerName: null,
        specialtyText: null,
        locationText: null,
        networkText: "No active Medicare FFS enrollment row found",
        sourceUpdatedAt: null,
        checkedAt,
        rawResult: body,
      };
    }

    const first = exactMatches[0];
    const enrollmentIds = exactMatches
      .map((row) => value(row, "ENRLMT_ID", "ENROLLMENT_ID"))
      .filter((id): id is string => Boolean(id));

    return {
      sourceKey: "cms_pecos_ffs",
      sourceRecordId: enrollmentIds[0] ?? normalizedNpi,
      directoryStatus: exactMatches.length > 1 ? "multiple_matches" : "found",
      providerNpi: normalizedNpi,
      providerName: formatCmsEnrollmentName(first),
      specialtyText: value(first, "PROVIDER_TYPE_DESC", "SPECIALTY_DESC"),
      locationText: formatCmsEnrollmentLocation(first),
      networkText: "Active Medicare FFS enrollment evidence found",
      sourceUpdatedAt: null,
      checkedAt,
      rawResult: {
        datasetId: CMS_PECOS_MAIN_DATASET_ID,
        enrollmentIds,
        rows: body,
      },
    };
  } catch (error) {
    return {
      sourceKey: "cms_pecos_ffs",
      sourceRecordId: null,
      directoryStatus: "source_unavailable",
      providerNpi: normalizedNpi,
      providerName: null,
      specialtyText: null,
      locationText: null,
      networkText: null,
      sourceUpdatedAt: null,
      checkedAt,
      rawResult: {
        datasetId: CMS_PECOS_MAIN_DATASET_ID,
        error: error instanceof Error ? error.message : "CMS PECOS lookup failed",
      },
    };
  }
}

export function discrepancyForExpectation(input: {
  expectedParticipation: boolean | null;
  observation: DirectoryObservation;
}) {
  const { expectedParticipation, observation } = input;

  if (observation.directoryStatus === "source_unavailable") {
    return {
      type: "source_unavailable",
      summary: "Public directory source could not be checked.",
    };
  }

  if (observation.directoryStatus === "unable_to_verify") {
    return {
      type: "unable_to_verify",
      summary: "Provider could not be verified against the public directory.",
    };
  }

  if (expectedParticipation === true && observation.directoryStatus === "not_found") {
    return {
      type: "expected_not_found",
      summary: "Provider is expected in this directory but was not found.",
    };
  }

  if (expectedParticipation === false && observation.directoryStatus === "found") {
    return {
      type: "unexpected_listing",
      summary: "Provider was found in a directory where participation is not expected.",
    };
  }

  return null;
}
