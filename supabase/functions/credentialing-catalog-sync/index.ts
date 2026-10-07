import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  cignaNetworkIds,
  insurancePlanProduct,
  isColoradoInsurancePlan,
  resolveCignaNetworkNames,
  type CignaInsurancePlan,
  type CignaLocation,
} from "../_shared/credentialing/cigna-catalog.ts";

const CIGNA_BASE_URL = "https://fhir.cigna.com/ProviderDirectory/v1/";
const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");

function secretKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    const parsed = JSON.parse(modern) as Record<string, string> & { default?: string };
    return parsed.default ?? Object.values(parsed)[0] ?? "";
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const serviceKey = secretKey();
type Row = Record<string, unknown>;
type Organization = { resourceType?: "Organization"; id?: string; name?: string };
type Bundle = {
  resourceType?: "Bundle";
  entry?: Array<{
    resource?: CignaInsurancePlan | CignaLocation | Organization | Row;
    search?: { mode?: string };
  }>;
  link?: Array<{ relation?: string; url?: string }>;
};

function headers(extra: HeadersInit = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: headers(init.headers),
  });
  if (!response.ok) {
    throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function credentialing_internal_secret_valid(value: string | null) {
  if (!value || !base || !serviceKey) return false;
  const response = await fetch(
    `${base}/rest/v1/rpc/credentialing_internal_secret_valid`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_secret: value }),
    },
  );
  return response.ok && (await response.json()) === true;
}

async function getOne(path: string): Promise<Row | null> {
  const rows = (await rest(`${path}&limit=1`)) as Row[];
  return rows?.[0] ?? null;
}

function externalPlanId(plan: CignaInsurancePlan) {
  return (
    plan.identifier?.find((identifier) => identifier.value)?.value ??
    plan.id ??
    null
  );
}

async function fetchCignaBundle(url: string): Promise<Bundle> {
  const response = await fetch(url, {
    headers: { accept: "application/fhir+json, application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Cigna Provider Directory HTTP ${response.status}`);
  }
  const body = (await response.json()) as Bundle;
  if (body.resourceType !== "Bundle") {
    throw new Error("Cigna Provider Directory returned a non-Bundle response");
  }
  const operationOutcome = body.entry?.find(
    (entry) => (entry.resource as Row | undefined)?.resourceType === "OperationOutcome",
  );
  if (operationOutcome) {
    throw new Error("Cigna Provider Directory returned an OperationOutcome");
  }
  return body;
}

async function fetchNetworkName(networkId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${CIGNA_BASE_URL}Organization/${encodeURIComponent(networkId)}`,
      {
        headers: { accept: "application/fhir+json, application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as Organization;
    return body.resourceType === "Organization" ? body.name ?? null : null;
  } catch {
    return null;
  }
}

async function savePlan(payerId: string, plan: CignaInsurancePlan) {
  const externalId = externalPlanId(plan);
  if (!externalId || !plan.name) return null;

  const existing = await getOne(
    `payer_plans?payer_id=eq.${encodeURIComponent(payerId)}&external_plan_id=eq.${encodeURIComponent(externalId)}&select=id`,
  );
  const product = insurancePlanProduct(plan);
  const payload = {
    payer_id: payerId,
    external_plan_id: externalId,
    name: plan.name,
    product_type: product.display,
    plan_type: product.code,
    market_segment: "commercial_or_medicare_advantage",
    state: "CO",
    active: true,
    source_updated_at: plan.meta?.lastUpdated ?? new Date().toISOString(),
  };

  if (existing?.id) {
    await rest(`payer_plans?id=eq.${encodeURIComponent(String(existing.id))}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
    return { id: String(existing.id), added: false };
  }

  const rows = (await rest("payer_plans?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  })) as Row[];
  return { id: String(rows[0].id), added: true };
}

async function saveNetworks(
  planId: string,
  externalNetworkIds: string[],
  networkNameCache: Map<string, string | null>,
) {
  if (!externalNetworkIds.length) return { added: 0, existing: 0 };

  const existingRows = (await rest(
    `payer_networks?plan_id=eq.${encodeURIComponent(planId)}&select=external_network_id`,
  )) as Row[];
  const existing = new Set(
    existingRows
      .map((row) =>
        typeof row.external_network_id === "string"
          ? row.external_network_id
          : null,
      )
      .filter((value): value is string => Boolean(value)),
  );

  const now = new Date().toISOString();
  const newRows = externalNetworkIds
    .filter((networkId) => !existing.has(networkId))
    .map((networkId) => ({
      plan_id: planId,
      external_network_id: networkId,
      name:
        networkNameCache.get(networkId) ?? `Cigna Network ${networkId}`,
      active: true,
      source_updated_at: now,
    }));

  if (newRows.length) {
    await rest("payer_networks", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(newRows),
    });
  }

  return {
    added: newRows.length,
    existing: externalNetworkIds.length - newRows.length,
  };
}

async function syncCigna() {
  const payer = await getOne("payers?adapter_key=eq.cigna&select=id,name");
  if (!payer?.id) throw new Error("Cigna payer reference is not configured");
  const payerId = String(payer.id);
  const syncRows = (await rest("payer_catalog_syncs?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      payer_id: payerId,
      status: "in_progress",
      source_version: "cigna-plan-net-r4",
    }),
  })) as Row[];
  const syncId = String(syncRows[0].id);

  let recordsAdded = 0;
  let recordsChanged = 0;
  let plansSeen = 0;
  let coloradoPlansSeen = 0;
  let nextUrl: string | null =
    `${CIGNA_BASE_URL}InsurancePlan?_count=50&_include=InsurancePlan%3Acoverage-area`;
  let pageCount = 0;
  const networkNameCache = new Map<string, string | null>();

  try {
    while (nextUrl && pageCount < 50) {
      pageCount += 1;
      const bundle = await fetchCignaBundle(nextUrl);
      const includedLocations = new Map(
        (bundle.entry ?? [])
          .map((entry) => entry.resource)
          .filter(
            (resource): resource is CignaLocation =>
              resource?.resourceType === "Location" && Boolean(resource.id),
          )
          .map((location) => [location.id as string, location]),
      );
      const plans = (bundle.entry ?? [])
        .filter((entry) => entry.search?.mode !== "include")
        .map((entry) => entry.resource)
        .filter(
          (resource): resource is CignaInsurancePlan =>
            resource?.resourceType === "InsurancePlan",
        );
      plansSeen += plans.length;

      const coloradoPlans = plans.filter((plan) =>
        isColoradoInsurancePlan(plan, includedLocations),
      );
      coloradoPlansSeen += coloradoPlans.length;

      const pageNetworkIds = [
        ...new Set(coloradoPlans.flatMap((plan) => cignaNetworkIds(plan))),
      ];
      await resolveCignaNetworkNames(
        pageNetworkIds,
        networkNameCache,
        fetchNetworkName,
        12,
      );

      for (const plan of coloradoPlans) {
        const saved = await savePlan(payerId, plan);
        if (!saved) continue;
        if (saved.added) recordsAdded += 1;
        else recordsChanged += 1;

        const networkResult = await saveNetworks(
          saved.id,
          cignaNetworkIds(plan),
          networkNameCache,
        );
        recordsAdded += networkResult.added;
        recordsChanged += networkResult.existing;
      }

      nextUrl = bundle.link?.find((link) => link.relation === "next")?.url ?? null;
    }

    await rest(`payer_catalog_syncs?id=eq.${encodeURIComponent(syncId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "completed",
        completed_at: new Date().toISOString(),
        records_added: recordsAdded,
        records_changed: recordsChanged,
        records_deactivated: 0,
      }),
    });
    return {
      payer: "Cigna",
      recordsAdded,
      recordsChanged,
      plansSeen,
      coloradoPlansSeen,
      uniqueNetworksResolved: networkNameCache.size,
      pages: pageCount,
    };
  } catch (error) {
    await rest(`payer_catalog_syncs?id=eq.${encodeURIComponent(syncId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "failed",
        completed_at: new Date().toISOString(),
        records_added: recordsAdded,
        records_changed: recordsChanged,
        records_deactivated: 0,
        error_summary:
          error instanceof Error ? error.message : "Cigna catalog sync failed",
      }),
    });
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (!base || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Catalog sync configuration missing" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const schedulerSecret = req.headers.get("x-therassistant-scheduler-secret");
  if (!(await credentialing_internal_secret_valid(schedulerSecret))) {
    return new Response(
      JSON.stringify({ error: "Unauthorized maintenance request" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const result = await syncCigna();
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Catalog sync failed",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
});
