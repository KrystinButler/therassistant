import { verifyCignaParticipation } from "../_shared/credentialing/cigna.ts";

const MAX_ATTEMPTS = 3;
const QUEUE_READ_RPC = "credentialing_worker_read_message";
const QUEUE_ARCHIVE_RPC = "credentialing_worker_archive_message";
const QUEUE_RETRY_RPC = "credentialing_worker_retry_message";

type Row = Record<string, unknown>;
type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: { runId?: string; tenantId?: string; attempt?: number };
};

type WorkerContext = {
  base: string;
  serviceKey: string;
};

function client(context: WorkerContext) {
  const headers = (extra: HeadersInit = {}) => ({
    apikey: context.serviceKey,
    Authorization: `Bearer ${context.serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  });

  async function rest(path: string, init: RequestInit = {}) {
    const response = await fetch(`${context.base}/rest/v1/${path}`, {
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

  async function rpc(name: string, body: Record<string, unknown> = {}) {
    return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  }

  async function getOne(table: string, query: string): Promise<Row | null> {
    const rows = (await rest(`${table}?${query}&limit=1`)) as Row[];
    return rows?.[0] ?? null;
  }

  return { rest, rpc, getOne };
}

async function patchRun(
  context: WorkerContext,
  runId: string,
  tenantId: string,
  patch: Row,
) {
  const { rest } = client(context);
  await rest(
    `participation_verification_runs?id=eq.${encodeURIComponent(runId)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
}

async function recordEvidence(
  context: WorkerContext,
  input: {
    runId: string;
    tenantId: string;
    sourceKey: string;
    sourceType: string;
    sourceReference?: string | null;
    sourceUpdatedAt?: string | null;
    adapterVersion: string;
    normalizedEvidence: Row;
  },
) {
  const { rest } = client(context);
  await rest("participation_verification_evidence", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      verification_id: input.runId,
      source_key: input.sourceKey,
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      source_updated_at: input.sourceUpdatedAt ?? null,
      adapter_version: input.adapterVersion,
      normalized_evidence: input.normalizedEvidence,
      content_type: "application/json",
    }),
  });
}

async function recordMatches(
  context: WorkerContext,
  runId: string,
  tenantId: string,
  rows: Array<{
    match_type: string;
    expected_value: string | null;
    observed_value: string | null;
    matched: boolean;
  }>,
) {
  if (!rows.length) return;
  const { rest } = client(context);
  await rest("participation_verification_matches", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(
      rows.map((row) => ({
        tenant_id: tenantId,
        verification_id: runId,
        score: row.matched ? 1 : 0,
        ...row,
      })),
    ),
  });
}

async function auditCompleted(
  context: WorkerContext,
  runId: string,
  tenantId: string,
  status: string,
) {
  const { rest } = client(context);
  await rest("audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      tenant_id: tenantId,
      actor_id: null,
      action: "VERIFICATION_COMPLETED",
      target_type: "participation_verification_run",
      target_id: runId,
      metadata: { status, worker: "credentialing-verification-worker" },
    }),
  });
}

async function recordAdapterHealth(
  context: WorkerContext,
  payerId: string,
  sourceKey: string,
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "MISCONFIGURED",
  sourceUpdatedAt: string | null,
  failureCode: string | null,
  failureDetail: string | null,
) {
  const { rest } = client(context);
  await rest("payer_adapter_health", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      payer_id: payerId,
      source_key: sourceKey,
      status,
      source_updated_at: sourceUpdatedAt,
      failure_code: failureCode,
      failure_detail: failureDetail,
      adapter_version: "1.0.0",
      freshness_threshold_hours: 24,
    }),
  });
}

async function completeUnable(
  context: WorkerContext,
  run: Row,
  tenantId: string,
  sourceKey: string,
  failureCode: string,
  failureDetail: string,
  officialFallbackUrl: string | null = null,
) {
  const runId = String(run.id);
  await recordEvidence(context, {
    runId,
    tenantId,
    sourceKey,
    sourceType: "CONTROLLED_FALLBACK",
    adapterVersion: "1.0.0",
    normalizedEvidence: {
      authoritativeSearchCompleted: false,
      failureCode,
      failureDetail,
      officialFallbackUrl,
      claimImpact: "none",
    },
  });
  await patchRun(context, runId, tenantId, {
    status: "UNABLE_TO_VERIFY",
    confidence: "LOW",
    source_type: "CONTROLLED_FALLBACK",
    source_reference: officialFallbackUrl,
    adapter_version: "1.0.0",
    matching_algorithm_version: "1.0.0",
    failure_code: failureCode,
    failure_detail: failureDetail,
    completed_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  });
  await auditCompleted(context, runId, tenantId, "UNABLE_TO_VERIFY");
}

async function completeSynthetic(
  context: WorkerContext,
  run: Row,
  tenantId: string,
) {
  const { getOne } = client(context);
  const runId = String(run.id);
  const provider = await getOne(
    "providers",
    `id=eq.${encodeURIComponent(String(run.provider_id))}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,individual_npi,taxonomy_code`,
  );
  const plan = await getOne(
    "payer_plans",
    `id=eq.${encodeURIComponent(String(run.plan_id))}&select=id,payer_id,state`,
  );
  const network = run.network_id
    ? await getOne(
        "payer_networks",
        `id=eq.${encodeURIComponent(String(run.network_id))}&select=id,plan_id`,
      )
    : null;
  if (!provider || !plan) {
    await completeUnable(
      context,
      run,
      tenantId,
      "synthetic",
      "INVALID_RESPONSE",
      "Synthetic verification context was incomplete.",
    );
    return;
  }
  const evidence = {
    authoritativeSearchCompleted: true,
    providerNpi: provider.individual_npi ?? null,
    planId: plan.id,
    networkId: network?.id ?? null,
    providerNetworkRelationshipConfirmed: true,
    claimImpact: "none",
  };
  await recordEvidence(context, {
    runId,
    tenantId,
    sourceKey: "synthetic",
    sourceType: "SYNTHETIC_TEST_ADAPTER",
    sourceReference: `synthetic:${runId}`,
    adapterVersion: "1.0.0",
    normalizedEvidence: evidence,
  });
  await recordMatches(context, runId, tenantId, [
    {
      match_type: "TYPE_1_NPI",
      expected_value: String(provider.individual_npi ?? ""),
      observed_value: String(provider.individual_npi ?? ""),
      matched: Boolean(provider.individual_npi),
    },
    {
      match_type: "PLAN",
      expected_value: String(run.plan_id),
      observed_value: String(plan.id),
      matched: String(run.plan_id) === String(plan.id),
    },
    {
      match_type: "NETWORK",
      expected_value: run.network_id ? String(run.network_id) : null,
      observed_value: network?.id ? String(network.id) : null,
      matched: !run.network_id || String(run.network_id) === String(network?.id),
    },
    {
      match_type: "PROVIDER_NETWORK_RELATIONSHIP",
      expected_value: "confirmed",
      observed_value: "confirmed",
      matched: true,
    },
  ]);
  await patchRun(context, runId, tenantId, {
    status: "PARTICIPATING",
    confidence: "HIGH",
    source_type: "SYNTHETIC_TEST_ADAPTER",
    source_reference: `synthetic:${runId}`,
    adapter_version: "1.0.0",
    matching_algorithm_version: "1.0.0",
    failure_code: null,
    failure_detail: null,
    completed_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  });
  await auditCompleted(context, runId, tenantId, "PARTICIPATING");
}

async function completeCigna(
  context: WorkerContext,
  run: Row,
  tenantId: string,
) {
  const { getOne } = client(context);
  const runId = String(run.id);
  const provider = await getOne(
    "providers",
    `id=eq.${encodeURIComponent(String(run.provider_id))}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,individual_npi,taxonomy_code`,
  );
  const plan = await getOne(
    "payer_plans",
    `id=eq.${encodeURIComponent(String(run.plan_id))}&select=id,payer_id,external_plan_id,state`,
  );
  const network = run.network_id
    ? await getOne(
        "payer_networks",
        `id=eq.${encodeURIComponent(String(run.network_id))}&select=id,plan_id,external_network_id`,
      )
    : null;
  const organization = run.organization_id
    ? await getOne(
        "practice_entities",
        `id=eq.${encodeURIComponent(String(run.organization_id))}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,group_npi`,
      )
    : null;
  const location = run.practice_location_id
    ? await getOne(
        "practice_locations",
        `id=eq.${encodeURIComponent(String(run.practice_location_id))}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,state,postal_code`,
      )
    : null;

  if (
    !provider?.individual_npi ||
    !plan?.id ||
    !network?.id ||
    !network.external_network_id
  ) {
    await completeUnable(
      context,
      run,
      tenantId,
      "cigna",
      "PLAN_NOT_FOUND",
      "Cigna verification requires a synchronized selected plan and network.",
      "https://developer.cigna.com/docs/service-apis/provider-directory",
    );
    return;
  }

  const result = await verifyCignaParticipation({
    providerNpi: String(provider.individual_npi),
    organizationNpi:
      typeof organization?.group_npi === "string" ? organization.group_npi : null,
    state: typeof location?.state === "string" ? location.state : "CO",
    postalCode:
      typeof location?.postal_code === "string" ? location.postal_code : null,
    planId: String(plan.id),
    networkId: String(network.id),
    externalNetworkId: String(network.external_network_id),
  });

  await recordEvidence(context, {
    runId,
    tenantId,
    sourceKey: "cigna",
    sourceType: "FHIR_PROVIDER_DIRECTORY",
    sourceReference: result.sourceReference,
    sourceUpdatedAt: result.sourceUpdatedAt,
    adapterVersion: "1.0.0",
    normalizedEvidence: { ...result, claimImpact: "none" },
  });

  await recordMatches(context, runId, tenantId, [
    {
      match_type: "TYPE_1_NPI",
      expected_value: String(provider.individual_npi),
      observed_value: result.providerNpi,
      matched: result.providerNpi === String(provider.individual_npi),
    },
    {
      match_type: "TYPE_2_NPI",
      expected_value:
        typeof organization?.group_npi === "string" ? organization.group_npi : null,
      observed_value: result.organizationNpi,
      matched:
        !organization?.group_npi || result.organizationNpi === organization.group_npi,
    },
    {
      match_type: "PLAN",
      expected_value: String(plan.id),
      observed_value: result.planId,
      matched: result.planId === String(plan.id),
    },
    {
      match_type: "NETWORK",
      expected_value: String(network.id),
      observed_value: result.networkId,
      matched: result.networkId === String(network.id),
    },
    {
      match_type: "STATE",
      expected_value: typeof location?.state === "string" ? location.state : "CO",
      observed_value: result.state,
      matched: result.state === (typeof location?.state === "string" ? location.state : "CO"),
    },
    {
      match_type: "POSTAL_CODE",
      expected_value:
        typeof location?.postal_code === "string" ? location.postal_code : null,
      observed_value: result.postalCode,
      matched:
        !location?.postal_code || result.postalCode === location.postal_code,
    },
    {
      match_type: "PROVIDER_NETWORK_RELATIONSHIP",
      expected_value: "confirmed",
      observed_value: result.providerNetworkRelationshipConfirmed
        ? "confirmed"
        : "unconfirmed",
      matched: result.providerNetworkRelationshipConfirmed,
    },
  ]);

  let status: "PARTICIPATING" | "NOT_FOUND" | "UNABLE_TO_VERIFY";
  let confidence: "HIGH" | "MEDIUM" | "LOW";
  if (result.failureCode && result.failureCode !== "PROVIDER_NOT_FOUND") {
    status = "UNABLE_TO_VERIFY";
    confidence = "LOW";
  } else if (
    result.authoritativeSearchCompleted &&
    result.providerNetworkRelationshipConfirmed
  ) {
    status = "PARTICIPATING";
    confidence = "HIGH";
  } else if (result.authoritativeSearchCompleted) {
    status = "NOT_FOUND";
    confidence = "MEDIUM";
  } else {
    status = "UNABLE_TO_VERIFY";
    confidence = "LOW";
  }

  await patchRun(context, runId, tenantId, {
    status,
    confidence,
    source_type: "FHIR_PROVIDER_DIRECTORY",
    source_reference: result.sourceReference,
    source_updated_at: result.sourceUpdatedAt,
    adapter_version: "1.0.0",
    matching_algorithm_version: "1.0.0",
    failure_code: status === "UNABLE_TO_VERIFY" ? result.failureCode ?? "SOURCE_UNAVAILABLE" : null,
    failure_detail: status === "UNABLE_TO_VERIFY" ? result.failureDetail ?? null : null,
    completed_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  });
  await recordAdapterHealth(
    context,
    String(run.payer_id),
    "cigna",
    status === "UNABLE_TO_VERIFY" ? "DEGRADED" : "HEALTHY",
    result.sourceUpdatedAt,
    status === "UNABLE_TO_VERIFY" ? result.failureCode ?? "SOURCE_UNAVAILABLE" : null,
    status === "UNABLE_TO_VERIFY" ? result.failureDetail ?? null : null,
  );
  await auditCompleted(context, runId, tenantId, status);
}

const FALLBACKS: Record<string, { url: string; reason: string }> = {
  cms_medicare: {
    url: "https://www.medicare.gov/care-compare/",
    reason:
      "Selected Medicare Advantage plan/network participation requires plan-specific provider-directory evidence.",
  },
  health_first_colorado: {
    url: "https://www.healthfirstcolorado.com/find-doctors/",
    reason:
      "Health First Colorado enrollment does not independently establish selected RAE/network participation.",
  },
  rae_rmhp: {
    url: "https://www.uhc.com/communityplan/colorado/plans/medicaid/health-first-colorado",
    reason: "Region 1 participation requires current RMHP plan/network directory evidence.",
  },
  rae_northeast_health_partners: {
    url: "https://www.northeasthealthpartners.org/",
    reason: "Region 2 participation requires current payer/network directory evidence.",
  },
  rae_ccha: {
    url: "https://www.cchacares.com/",
    reason: "Region 3 participation requires current CCHA network directory evidence.",
  },
  rae_colorado_access: {
    url: "https://www.coaccess.com/members/find-a-provider/",
    reason: "Region 4 participation requires current Colorado Access network directory evidence.",
  },
  aetna: {
    url: "https://www.aetna.com/individuals-families/find-a-doctor.html",
    reason: "Aetna selected plan/network API access is not configured for this deployment.",
  },
  anthem: {
    url: "https://www.anthem.com/find-care/",
    reason: "A verified current Anthem Plan-Net endpoint and selected network mapping are not configured.",
  },
  uhc: {
    url: "https://www.uhc.com/find-a-doctor",
    reason: "A current machine-readable UHC Colorado plan/network mapping is not configured.",
  },
  tricare_west: {
    url: "https://tricare.mil/About/Regions/West-Region/Find-Care/West-Region-Providers",
    reason: "TRICARE West currently uses the official TriWest provider directory fallback.",
  },
};

async function processMessage(
  context: WorkerContext,
  item: QueueMessage,
) {
  const { rpc, getOne } = client(context);
  const runId = item.message?.runId;
  const tenantId = item.message?.tenantId;
  if (!runId || !tenantId) {
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "archived_invalid_message" };
  }

  const run = await getOne(
    "participation_verification_runs",
    `id=eq.${encodeURIComponent(runId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
  );
  if (!run || run.status !== "IN_PROGRESS") {
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "archived_stale_message" };
  }

  const payer = await getOne(
    "payers",
    `id=eq.${encodeURIComponent(String(run.payer_id))}&select=id,adapter_key,name`,
  );
  const adapterKey = typeof payer?.adapter_key === "string" ? payer.adapter_key : "";

  try {
    if (adapterKey === "synthetic") {
      await completeSynthetic(context, run, tenantId);
    } else if (adapterKey === "cigna") {
      await completeCigna(context, run, tenantId);
    } else {
      const fallback = FALLBACKS[adapterKey];
      await completeUnable(
        context,
        run,
        tenantId,
        adapterKey || "unconfigured",
        "SOURCE_UNAVAILABLE",
        fallback?.reason ??
          (adapterKey
            ? `Adapter ${adapterKey} is not yet configured for automated plan/network verification.`
            : "No payer adapter is configured for automated plan/network verification."),
        fallback?.url ?? null,
      );
    }
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "completed", runId };
  } catch (error) {
    const failureCode = "TRANSIENT_NETWORK";
    const attempts = Math.max(
      item.read_ct ?? 0,
      Number(item.message?.attempt ?? 0) + 1,
    );
    if (
      (failureCode === "TRANSIENT_NETWORK" || failureCode === "RATE_LIMITED") &&
      attempts < MAX_ATTEMPTS
    ) {
      await rpc(QUEUE_RETRY_RPC, {
        p_msg_id: item.msg_id,
        p_delay_seconds: Math.min(60 * 2 ** attempts, 600),
      });
      return { status: "retry_scheduled", runId, attempts };
    }
    await completeUnable(
      context,
      run,
      tenantId,
      adapterKey || "worker",
      "SOURCE_UNAVAILABLE",
      error instanceof Error ? error.message : "Credentialing source unavailable.",
      FALLBACKS[adapterKey]?.url ?? null,
    );
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "completed_unable_to_verify", runId };
  }
}

export async function handleVerificationWorker(context: WorkerContext) {
  const { rpc } = client(context);
  const rows = (await rpc(QUEUE_READ_RPC)) as QueueMessage[] | null;
  const item = rows?.[0];
  if (!item) return { status: "empty" };
  return processMessage(context, item);
}

export { MAX_ATTEMPTS };
