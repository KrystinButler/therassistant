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
