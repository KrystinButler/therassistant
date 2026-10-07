import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
type Reference = { reference?: string };
type Location = {
  resourceType?: "Location";
  id?: string;
  address?: { state?: string };
};
type InsurancePlan = {
  resourceType?: "InsurancePlan";
  id?: string;
  name?: string;
  identifier?: Array<{ system?: string; value?: string }>;
  meta?: { lastUpdated?: string };
  coverageArea?: Reference[];
  network?: Reference[];
  plan?: Array<{
    type?: { coding?: Array<{ code?: string; display?: string }> };
    coverageArea?: Reference[];
    network?: Reference[];
  }>;
};
type Organization = {
  resourceType?: "Organization";
  id?: string;
  name?: string;
};
type Bundle = {
  resourceType?: "Bundle";
  entry?: Array<{ resource?: InsurancePlan | Location | Organization | Row; search?: { mode?: string } }>;
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
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getOne(path: string): Promise<Row | null> {
  const rows = (await rest(`${path}&limit=1`)) as Row[];
  return rows?.[0] ?? null;
}

function idFromReference(reference: string | undefined) {
  if (!reference) return null;
  return reference.replace(/\/$/, "").split("/").pop() ?? null;
}

function externalPlanId(plan: InsurancePlan) {
  return plan.identifier?.find((identifier) => identifier.value)?.value ?? plan.id ?? null;
}

function allCoverageAreaIds(plan: InsurancePlan) {
  const refs = [
    ...(plan.coverageArea ?? []),
    ...(plan.plan ?? []).flatMap((component) => component.coverageArea ?? []),
  ];
  return new Set(refs.map((ref) => idFromReference(ref.reference)).filter(Boolean));
}

function allNetworkIds(plan: InsurancePlan) {
  const refs = [
    ...(plan.network ?? []),
    ...(plan.plan ?? []).flatMap((component) => component.network ?? []),
  ];
  return [...new Set(refs.map((ref) => idFromReference(ref.reference)).filter((id): id is string => Boolean(id)))];
}

async function fetchCignaBundle(url: string): Promise<Bundle> {
  const response = await fetch(url, {
    headers: { accept: "application/fhir+json, application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cigna Provider Directory HTTP ${response.status}`);
  const body = (await response.json()) as Bundle;
  if (body.resourceType !== "Bundle") throw new Error("Cigna Provider Directory returned a non-Bundle response");
  return body;
}

async function fetchNetwork(networkId: string): Promise<Organization | null> {
  const response = await fetch(`${CIGNA_BASE_URL}Organization/${encodeURIComponent(networkId)}`, {
    headers: { accept: "application/fhir+json, application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as Organization;
  return body.resourceType === "Organization" ? body : null;
}

async function savePlan(payerId: string, plan: InsurancePlan) {
  const externalId = externalPlanId(plan);
  if (!externalId || !plan.name) return null;
  const existing = await getOne(
    `payer_plans?payer_id=eq.${encodeURIComponent(payerId)}&external_plan_id=eq.${encodeURIComponent(externalId)}&select=id`,
  );
  const payload = {
    payer_id: payerId,
    external_plan_id: externalId,
    name: plan.name,
    product_type: plan.plan?.[0]?.type?.coding?.[0]?.display ?? null,
    plan_type: plan.plan?.[0]?.type?.coding?.[0]?.code ?? null,
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

async function saveNetwork(planId: string, externalNetworkId: string) {
  const existing = await getOne(
    `payer_networks?plan_id=eq.${encodeURIComponent(planId)}&external_network_id=eq.${encodeURIComponent(externalNetworkId)}&select=id`,
  );
  const network = await fetchNetwork(externalNetworkId);
  const payload = {
    plan_id: planId,
    external_network_id: externalNetworkId,
    name: network?.name ?? `Cigna Network ${externalNetworkId}`,
    active: true,
    source_updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await rest(`payer_networks?id=eq.${encodeURIComponent(String(existing.id))}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
    return false;
  }
  await rest("payer_networks", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  return true;
}

async function syncCigna() {
  const payer = await getOne("payers?adapter_key=eq.cigna&select=id,name");
  if (!payer?.id) throw new Error("Cigna payer reference is not configured");
  const payerId = String(payer.id);
  const syncRows = (await rest("payer_catalog_syncs?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ payer_id: payerId, status: "in_progress", source_version: "cigna-plan-net-r4" }),
  })) as Row[];
  const syncId = String(syncRows[0].id);

  let recordsAdded = 0;
  let recordsChanged = 0;
  let nextUrl: string | null = `${CIGNA_BASE_URL}InsurancePlan?_count=200&_include=InsurancePlan%3Acoverage-area`;
  let pageCount = 0;

  try {
    while (nextUrl && pageCount < 50) {
      pageCount += 1;
      const bundle = await fetchCignaBundle(nextUrl);
      const includedLocations = new Map(
        (bundle.entry ?? [])
          .map((entry) => entry.resource)
          .filter((resource): resource is Location => resource?.resourceType === "Location" && Boolean(resource.id))
          .map((location) => [location.id as string, location]),
      );
      const plans = (bundle.entry ?? [])
        .filter((entry) => entry.search?.mode !== "include")
        .map((entry) => entry.resource)
        .filter((resource): resource is InsurancePlan => resource?.resourceType === "InsurancePlan");

      for (const plan of plans) {
        const coverageIds = allCoverageAreaIds(plan);
        const isColorado = [...coverageIds].some(
          (id) => includedLocations.get(id ?? "")?.address?.state?.toUpperCase() === "CO",
        );
        if (!isColorado) continue;
        const saved = await savePlan(payerId, plan);
        if (!saved) continue;
        if (saved.added) recordsAdded += 1;
        else recordsChanged += 1;
        for (const networkId of allNetworkIds(plan)) {
          if (await saveNetwork(saved.id, networkId)) recordsAdded += 1;
          else recordsChanged += 1;
        }
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
    return { payer: "Cigna", recordsAdded, recordsChanged, pages: pageCount };
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
        error_summary: error instanceof Error ? error.message : "Cigna catalog sync failed",
      }),
    });
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (!req.headers.get("authorization")?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authorization required" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  if (!base || !serviceKey) {
    return new Response(JSON.stringify({ error: "Catalog sync configuration missing" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  try {
    const result = await syncCigna();
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Catalog sync failed" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
});
