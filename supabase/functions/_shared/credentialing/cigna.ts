const CIGNA_BASE_URL = "https://fhir.cigna.com/ProviderDirectory/v1/";
const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const NETWORK_EXTENSION =
  "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/network-reference";

export type CignaVerificationInput = {
  providerNpi: string;
  organizationNpi: string | null;
  state: string;
  postalCode: string | null;
  planId: string;
  networkId: string | null;
  externalNetworkId: string;
};

export type CignaVerificationResult = {
  authoritativeSearchCompleted: boolean;
  providerNpi: string | null;
  organizationNpi: string | null;
  planId: string | null;
  networkId: string | null;
  state: string | null;
  postalCode: string | null;
  taxonomyCode: string | null;
  providerNetworkRelationshipConfirmed: boolean;
  sourceReference: string | null;
  sourceUpdatedAt: string | null;
  raw: unknown;
  failureCode?:
    | "TRANSIENT_NETWORK"
    | "RATE_LIMITED"
    | "SOURCE_UNAVAILABLE"
    | "INVALID_RESPONSE"
    | "PROVIDER_NOT_FOUND"
    | "AMBIGUOUS_RESULT";
  failureDetail?: string;
};

type FhirIdentifier = {
  system?: string;
  value?: string;
};

type FhirReference = {
  reference?: string;
};

type FhirExtension = {
  url?: string;
  valueReference?: FhirReference;
};

type Practitioner = {
  resourceType?: "Practitioner";
  id?: string;
  identifier?: FhirIdentifier[];
  meta?: { lastUpdated?: string };
};

type PractitionerRole = {
  resourceType?: "PractitionerRole";
  id?: string;
  practitioner?: FhirReference;
  organization?: FhirReference;
  location?: FhirReference[];
  extension?: FhirExtension[];
  specialty?: Array<{ coding?: Array<{ code?: string }> }>;
  meta?: { lastUpdated?: string };
};

type Organization = {
  resourceType?: "Organization";
  id?: string;
  identifier?: FhirIdentifier[];
};

type Location = {
  resourceType?: "Location";
  id?: string;
  address?: {
    state?: string;
    postalCode?: string;
  };
};

type BundleEntry = {
  resource?: Practitioner | PractitionerRole | Organization | Location | Record<string, unknown>;
};

type Bundle = {
  resourceType?: "Bundle";
  entry?: BundleEntry[];
  link?: Array<{ relation?: string; url?: string }>;
};

function exactNpi(resource: Practitioner | Organization, npi: string) {
  return Boolean(
    resource.identifier?.some(
      (identifier) =>
        identifier.system === NPI_SYSTEM && identifier.value === npi,
    ),
  );
}

function idFromReference(reference: string | undefined) {
  if (!reference) return null;
  const clean = reference.split("?")[0].replace(/\/$/, "");
  return clean.split("/").pop() ?? null;
}

function roleReferencesNetwork(role: PractitionerRole, externalNetworkId: string) {
  const targetId = idFromReference(externalNetworkId) ?? externalNetworkId;
  return Boolean(
    role.extension?.some((extension) => {
      if (extension.url !== NETWORK_EXTENSION) return false;
      return idFromReference(extension.valueReference?.reference) === targetId;
    }),
  );
}

function locationMatches(
  location: Location,
  state: string,
  postalCode: string | null,
) {
  if ((location.address?.state ?? "").toUpperCase() !== state.toUpperCase()) {
    return false;
  }
  if (!postalCode) return true;
  const expected = postalCode.replace(/\D/g, "").slice(0, 5);
  const observed = (location.address?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  return Boolean(expected && observed && expected === observed);
}

async function getBundle(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ bundle: Bundle | null; failureCode?: CignaVerificationResult["failureCode"]; failureDetail?: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/fhir+json, application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      return { bundle: null, failureCode: "RATE_LIMITED", failureDetail: "Cigna Provider Directory rate limited the request." };
    }
    if (!response.ok) {
      return {
        bundle: null,
        failureCode: response.status >= 500 ? "SOURCE_UNAVAILABLE" : "INVALID_RESPONSE",
        failureDetail: `Cigna Provider Directory returned HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as Bundle;
    if (body.resourceType !== "Bundle") {
      return { bundle: null, failureCode: "INVALID_RESPONSE", failureDetail: "Cigna response was not a FHIR Bundle." };
    }
    return { bundle: body };
  } catch (error) {
    return {
      bundle: null,
      failureCode: "TRANSIENT_NETWORK",
      failureDetail: error instanceof Error ? error.message : "Cigna Provider Directory request failed.",
    };
  }
}

export async function verifyCignaParticipation(
  input: CignaVerificationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CignaVerificationResult> {
  const practitionerUrl = `${CIGNA_BASE_URL}Practitioner?identifier=${encodeURIComponent(`${NPI_SYSTEM}|${input.providerNpi}`)}`;
  const practitionerResponse = await getBundle(practitionerUrl, fetchImpl);
  if (!practitionerResponse.bundle) {
    return {
      authoritativeSearchCompleted: false,
      providerNpi: null,
      organizationNpi: null,
      planId: input.planId,
      networkId: input.networkId,
      state: null,
      postalCode: null,
      taxonomyCode: null,
      providerNetworkRelationshipConfirmed: false,
      sourceReference: practitionerUrl,
      sourceUpdatedAt: null,
      raw: null,
      failureCode: practitionerResponse.failureCode,
      failureDetail: practitionerResponse.failureDetail,
    };
  }

  const practitioners = (practitionerResponse.bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Practitioner => resource?.resourceType === "Practitioner")
    .filter((practitioner) => exactNpi(practitioner, input.providerNpi));

  if (practitioners.length === 0) {
    return {
      authoritativeSearchCompleted: true,
      providerNpi: null,
      organizationNpi: null,
      planId: input.planId,
      networkId: input.networkId,
      state: null,
      postalCode: null,
      taxonomyCode: null,
      providerNetworkRelationshipConfirmed: false,
      sourceReference: practitionerUrl,
      sourceUpdatedAt: null,
      raw: practitionerResponse.bundle,
      failureCode: "PROVIDER_NOT_FOUND",
      failureDetail: "Exact Type 1 NPI was not found in the Cigna Provider Directory.",
    };
  }

  if (practitioners.length > 1) {
    return {
      authoritativeSearchCompleted: true,
      providerNpi: input.providerNpi,
      organizationNpi: null,
      planId: input.planId,
      networkId: input.networkId,
      state: null,
      postalCode: null,
      taxonomyCode: null,
      providerNetworkRelationshipConfirmed: false,
      sourceReference: practitionerUrl,
      sourceUpdatedAt: null,
      raw: practitionerResponse.bundle,
      failureCode: "AMBIGUOUS_RESULT",
      failureDetail: "Multiple exact-NPI practitioner resources were returned by Cigna.",
    };
  }

  const practitioner = practitioners[0];
  const practitionerReference = `Practitioner/${practitioner.id}`;
  const networkReference = `Organization/${idFromReference(input.externalNetworkId) ?? input.externalNetworkId}`;
  const roleUrl = `${CIGNA_BASE_URL}PractitionerRole?practitioner=${encodeURIComponent(practitionerReference)}&network=${encodeURIComponent(networkReference)}&_include=PractitionerRole%3Alocation`;
  const roleResponse = await getBundle(roleUrl, fetchImpl);
  if (!roleResponse.bundle) {
    return {
      authoritativeSearchCompleted: false,
      providerNpi: input.providerNpi,
      organizationNpi: null,
      planId: input.planId,
      networkId: input.networkId,
      state: null,
      postalCode: null,
      taxonomyCode: null,
      providerNetworkRelationshipConfirmed: false,
      sourceReference: roleUrl,
      sourceUpdatedAt: practitioner.meta?.lastUpdated ?? null,
      raw: { practitioner: practitionerResponse.bundle },
      failureCode: roleResponse.failureCode,
      failureDetail: roleResponse.failureDetail,
    };
  }

  let roles = (roleResponse.bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is PractitionerRole => resource?.resourceType === "PractitionerRole")
    .filter((role) => idFromReference(role.practitioner?.reference) === practitioner.id)
    .filter((role) => roleReferencesNetwork(role, input.externalNetworkId));

  let matchedOrganizationNpi: string | null = null;
  if (input.organizationNpi) {
    const organizationUrl = `${CIGNA_BASE_URL}Organization?identifier=${encodeURIComponent(`${NPI_SYSTEM}|${input.organizationNpi}`)}`;
    const organizationResponse = await getBundle(organizationUrl, fetchImpl);
    if (!organizationResponse.bundle) {
      return {
        authoritativeSearchCompleted: false,
        providerNpi: input.providerNpi,
        organizationNpi: null,
        planId: input.planId,
        networkId: input.networkId,
        state: null,
        postalCode: null,
        taxonomyCode: null,
        providerNetworkRelationshipConfirmed: false,
        sourceReference: organizationUrl,
        sourceUpdatedAt: practitioner.meta?.lastUpdated ?? null,
        raw: { practitioner: practitionerResponse.bundle, roles: roleResponse.bundle },
        failureCode: organizationResponse.failureCode,
        failureDetail: organizationResponse.failureDetail,
      };
    }
    const organizations = (organizationResponse.bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is Organization => resource?.resourceType === "Organization")
      .filter((organization) => exactNpi(organization, input.organizationNpi as string));
    const organizationIds = new Set(organizations.map((organization) => organization.id).filter(Boolean));
    roles = roles.filter((role) => organizationIds.has(idFromReference(role.organization?.reference) ?? ""));
    if (roles.length) matchedOrganizationNpi = input.organizationNpi;
  }

  const locations = (roleResponse.bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Location => resource?.resourceType === "Location");
  const matchingLocationIds = new Set(
    locations.filter((location) => locationMatches(location, input.state, input.postalCode)).map((location) => location.id).filter(Boolean),
  );
  if (input.postalCode || input.state) {
    roles = roles.filter((role) =>
      role.location?.some((reference) => matchingLocationIds.has(idFromReference(reference.reference) ?? "")),
    );
  }

  const matchedRole = roles[0];
  const sourceReference = matchedRole?.id
    ? `${CIGNA_BASE_URL}PractitionerRole/${matchedRole.id}`
    : roleUrl;

  return {
    authoritativeSearchCompleted: true,
    providerNpi: input.providerNpi,
    organizationNpi: matchedOrganizationNpi,
    planId: input.planId,
    networkId: input.networkId,
    state: matchedRole ? input.state : null,
    postalCode: matchedRole ? input.postalCode : null,
    taxonomyCode: matchedRole?.specialty?.[0]?.coding?.[0]?.code ?? null,
    providerNetworkRelationshipConfirmed: Boolean(matchedRole),
    sourceReference,
    sourceUpdatedAt: matchedRole?.meta?.lastUpdated ?? practitioner.meta?.lastUpdated ?? null,
    raw: {
      practitioner: practitionerResponse.bundle,
      practitionerRole: roleResponse.bundle,
    },
  };
}

export { CIGNA_BASE_URL, NETWORK_EXTENSION, NPI_SYSTEM };
