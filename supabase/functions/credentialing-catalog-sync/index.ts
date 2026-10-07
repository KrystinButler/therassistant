import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  cignaCanonicalPlanKey,
  cignaNetworkIds,
  insurancePlanProduct,
  isColoradoInsurancePlan,
  resolveCignaNetworkNames,
  type CignaInsurancePlan,
  type CignaLocation,
} from "../_shared/credentialing/cigna-catalog.ts";

const CIGNA_BASE_URL = "https://fhir.cigna.com/ProviderDirectory/v1/";
const INITIAL_CIGNA_CATALOG_URL =
  `${CIGNA_BASE_URL}InsurancePlan?_count=50&_include=InsurancePlan%3Acoverage-area`;
const MAX_PAGES_PER_INVOCATION = 1;
const CATALOG_REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000;
const ACTIVE_SYNC_LEASE_MS = 10 * 60 * 1000;
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

type PlanCaches = {
  canonicalPlanCache: Map<string, string>;
  externalPlanCache: Map<string, string>;
};

type SyncState =
  | { mode: "fresh"; completedAt: string | null }
  | { mode: "busy"; syncId: string }
  | { mode: "work"; row: Row };

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

function stringValue(row: Row, key: string) {
  return typeof row[key] === "string" ? String(row[key]) : null;
}

function numberValue(row: Row, key: string) {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function patchSync(syncId: string, patch: Row) {
  await rest(`payer_catalog_syncs?id=eq.${encodeURIComponent(syncId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

async function getOrStartSync(payerId: string): Promise<SyncState> {
  const now = Date.now();
  let open = await getOne(
    `payer_catalog_syncs?payer_id=eq.${encodeURIComponent(payerId)}&status=eq.in_progress&select=id,started_at,last_progress_at,next_cursor_url,pages_processed,records_added,records_changed,records_deactivated&order=started_at.desc`,
  );

  if (open?.id) {
    const syncId = String(open.id);
    const lastProgressText =
      stringValue(open, "last_progress_at") ?? stringValue(open, "started_at");
    const lastProgressMs = lastProgressText ? Date.parse(lastProgressText) : 0;
    const ageMs = lastProgressMs > 0 ? now - lastProgressMs : ACTIVE_SYNC_LEASE_MS + 1;
    const pagesProcessed = numberValue(open, "pages_processed");
    const nextCursor = stringValue(open, "next_cursor_url");

    if (ageMs < ACTIVE_SYNC_LEASE_MS) {
      return { mode: "busy", syncId };
    }

    if (!nextCursor && pagesProcessed === 0) {
      await patchSync(syncId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_summary:
          "Catalog synchronization was interrupted before its first durable page checkpoint.",
      });
      open = null;
    } else if (!nextCursor && pagesProcessed > 0) {
      const completedAt = new Date().toISOString();
      await patchSync(syncId, {
        status: "completed",
        completed_at: completedAt,
        last_progress_at: completedAt,
        error_summary: null,
      });
      return { mode: "fresh", completedAt };
    } else {
      return { mode: "work", row: open };
    }
  }

  const freshnessCutoff = new Date(now - CATALOG_REFRESH_INTERVAL_MS).toISOString();
  const recentCompleted = await getOne(
    `payer_catalog_syncs?payer_id=eq.${encodeURIComponent(payerId)}&status=eq.completed&pages_processed=gt.0&completed_at=gte.${encodeURIComponent(freshnessCutoff)}&select=id,completed_at&order=completed_at.desc`,
  );
  if (recentCompleted?.id) {
    return {
      mode: "fresh",
      completedAt: stringValue(recentCompleted, "completed_at"),
    };
  }

  const startedAt = new Date().toISOString();
  const rows = (await rest("payer_catalog_syncs?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      payer_id: payerId,
      status: "in_progress",
      source_version: "cigna-plan-net-r4",
      next_cursor_url: INITIAL_CIGNA_CATALOG_URL,
      pages_processed: 0,
      last_progress_at: startedAt,
    }),
  })) as Row[];
  return { mode: "work", row: rows[0] };
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

async function loadPlanCaches(payerId: string): Promise<PlanCaches> {
  const rows = (await rest(
    `payer_plans?payer_id=eq.${encodeURIComponent(payerId)}&state=eq.CO&select=id,external_plan_id,name,plan_type,product_type`,
  )) as Row[];
  const canonicalPlanCache = new Map<string, string>();
  const externalPlanCache = new Map<string, string>();

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;

    const externalId =
      typeof row.external_plan_id === "string" ? row.external_plan_id : null;
    if (externalId) externalPlanCache.set(externalId, id);

    const product =
      typeof row.plan_type === "string"
        ? row.plan_type
        : typeof row.product_type === "string"
          ? row.product_type
          : null;
    const key = cignaCanonicalPlanKey(
      typeof row.name === "string" ? row.name : null,
      product,
    );
    if (key !== "|") canonicalPlanCache.set(key, id);
  }

  return { canonicalPlanCache, externalPlanCache };
}

async function savePlan(
  payerId: string,
  plan: CignaInsurancePlan,
  caches: PlanCaches,
) {
  const externalId = externalPlanId(plan);
  if (!externalId || !plan.name) return null;

  const product = insurancePlanProduct(plan);
  const canonicalKey = cignaCanonicalPlanKey(
    plan.name,
    product.code ?? product.display,
  );
  const cachedByExternal = caches.externalPlanCache.get(externalId);
  const cachedByCanonical = caches.canonicalPlanCache.get(canonicalKey);
  const existingId = cachedByExternal ?? cachedByCanonical ?? null;
  const payload = {
    payer_id: payerId,
    name: plan.name,
    product_type: product.display,
    plan_type: product.code,
    market_segment: "commercial_or_medicare_advantage",
    state: "CO",
    active: true,
    source_updated_at: plan.meta?.lastUpdated ?? new Date().toISOString(),
  };

  if (existingId) {
    await rest(`payer_plans?id=eq.${encodeURIComponent(existingId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
    caches.externalPlanCache.set(externalId, existingId);
    caches.canonicalPlanCache.set(canonicalKey, existingId);
    return { id: existingId, added: false };
  }

  const rows = (await rest("payer_plans?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...payload, external_plan_id: externalId }),
  })) as Row[];
  const id = String(rows[0].id);
  caches.externalPlanCache.set(externalId, id);
  caches.canonicalPlanCache.set(canonicalKey, id);
  return { id, added: true };
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
  const syncState = await getOrStartSync(payerId);

  if (syncState.mode === "fresh") {
    return {
      payer: "Cigna",
      status: "fresh",
      completedAt: syncState.completedAt,
    };
  }
  if (syncState.mode === "busy") {
    return { payer: "Cigna", status: "busy", syncId: syncState.syncId };
  }

  const checkpoint = syncState.row;
  const syncId = String(checkpoint.id);
  let recordsAdded = 0;
  let recordsChanged = 0;
  let plansSeen = 0;
  let coloradoPlansSeen = 0;
  let nextUrl: string | null =
    stringValue(checkpoint, "next_cursor_url") ?? INITIAL_CIGNA_CATALOG_URL;
  let pagesProcessed = numberValue(checkpoint, "pages_processed");
  const previousAdded = numberValue(checkpoint, "records_added");
  const previousChanged = numberValue(checkpoint, "records_changed");
  const previousDeactivated = numberValue(checkpoint, "records_deactivated");
  const networkNameCache = new Map<string, string | null>();
  const planCaches = await loadPlanCaches(payerId);
  const { canonicalPlanCache, externalPlanCache } = planCaches;

  try {
    for (
      let page = 0;
      nextUrl && page < MAX_PAGES_PER_INVOCATION;
      page += 1
    ) {
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
        const saved = await savePlan(payerId, plan, {
          canonicalPlanCache,
          externalPlanCache,
        });
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
      pagesProcessed += 1;
    }

    const checkpointAt = new Date().toISOString();
    const completed = !nextUrl;
    await patchSync(syncId, {
      status: completed ? "completed" : "in_progress",
      completed_at: completed ? checkpointAt : null,
      last_progress_at: checkpointAt,
      next_cursor_url: nextUrl,
      pages_processed: pagesProcessed,
      records_added: previousAdded + recordsAdded,
      records_changed: previousChanged + recordsChanged,
      records_deactivated: previousDeactivated,
      error_summary: null,
    });

    return {
      payer: "Cigna",
      status: completed ? "completed" : "in_progress",
      syncId,
      recordsAdded,
      recordsChanged,
      plansSeen,
      coloradoPlansSeen,
      canonicalPlans: canonicalPlanCache.size,
      externalPlanIdsSeen: externalPlanCache.size,
      uniqueNetworksResolved: networkNameCache.size,
      pagesProcessed,
      hasMore: Boolean(nextUrl),
    };
  } catch (error) {
    await patchSync(syncId, {
      last_progress_at: new Date().toISOString(),
      error_summary:
        error instanceof Error ? error.message : "Cigna catalog sync failed",
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
