export type CignaCoverageArea = {
  reference?: string;
  display?: string;
};

export type CignaLocation = {
  resourceType?: "Location";
  id?: string;
  address?: { state?: string };
};

export type CignaInsurancePlan = {
  resourceType?: "InsurancePlan";
  id?: string;
  name?: string;
  identifier?: Array<{ system?: string; value?: string }>;
  meta?: {
    lastUpdated?: string;
    tag?: Array<{ code?: string; display?: string }>;
  };
  type?: Array<{
    coding?: Array<{ code?: string; display?: string }>;
  }>;
  coverageArea?: CignaCoverageArea[];
  network?: Array<{ reference?: string }>;
  plan?: Array<{
    type?: { coding?: Array<{ code?: string; display?: string }> };
    coverageArea?: CignaCoverageArea[];
    network?: Array<{ reference?: string }>;
  }>;
};

function idFromReference(reference: string | undefined) {
  if (!reference) return null;
  return reference.replace(/\/$/, "").split("/").pop() ?? null;
}

function directCoverageState(area: CignaCoverageArea) {
  const display = area.display?.trim().toUpperCase();
  return display && /^[A-Z]{2}$/.test(display) ? display : null;
}

export function isColoradoInsurancePlan(
  plan: CignaInsurancePlan,
  includedLocations: Map<string, CignaLocation>,
) {
  const coverageAreas = [
    ...(plan.coverageArea ?? []),
    ...(plan.plan ?? []).flatMap((component) => component.coverageArea ?? []),
  ];

  if (coverageAreas.some((area) => directCoverageState(area) === "CO")) {
    return true;
  }

  if (
    coverageAreas.some((area) => {
      const id = idFromReference(area.reference);
      return id
        ? includedLocations.get(id)?.address?.state?.trim().toUpperCase() === "CO"
        : false;
    })
  ) {
    return true;
  }

  return Boolean(
    plan.meta?.tag?.some(
      (tag) =>
        tag.code?.trim().toUpperCase() === "CO" ||
        tag.display?.trim().toUpperCase() === "COLORADO",
    ),
  );
}

export function insurancePlanProduct(plan: CignaInsurancePlan) {
  const coding =
    plan.type?.flatMap((entry) => entry.coding ?? []).find(
      (entry) => entry.code || entry.display,
    ) ??
    plan.plan
      ?.flatMap((component) => component.type?.coding ?? [])
      .find((entry) => entry.code || entry.display);

  return {
    code: coding?.code ?? null,
    display: coding?.display ?? null,
  };
}

export function cignaNetworkIds(plan: CignaInsurancePlan) {
  const refs = [
    ...(plan.network ?? []),
    ...(plan.plan ?? []).flatMap((component) => component.network ?? []),
  ];

  return [
    ...new Set(
      refs
        .map((ref) => idFromReference(ref.reference))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}
