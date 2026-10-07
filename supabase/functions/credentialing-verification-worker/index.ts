import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MAX_ATTEMPTS = 3;
const QUEUE_READ_RPC = "credentialing_worker_read_message";
const QUEUE_ARCHIVE_RPC = "credentialing_worker_archive_message";
const QUEUE_RETRY_RPC = "credentialing_worker_retry_message";

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

async function rpc(name: string, body: Record<string, unknown> = {}) {
  return rest(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: {
    runId?: string;
    tenantId?: string;
    attempt?: number;
  };
};

type Row = Record<string, unknown>;

async function getOne(table: string, query: string): Promise<Row | null> {
  const rows = (await rest(`${table}?${query}&limit=1`)) as Row[];
  return rows?.[0] ?? null;
}

async function patchRun(runId: string, tenantId: string, patch: Row) {
  await rest(
    `participation_verification_runs?id=eq.${encodeURIComponent(runId)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
}

async function recordEvidence(input: {
  runId: string;
  tenantId: string;
  sourceKey: string;
  sourceType: string;
  sourceReference?: string | null;
  sourceUpdatedAt?: string | null;
  adapterVersion: string;
  normalizedEvidence: Row;
}) {
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

async function auditCompleted(runId: string, tenantId: string, status: string) {
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

async function completeUnable(
  run: Row,
  tenantId: string,
  sourceKey: string,
  failureCode: string,
  failureDetail: string,
) {
  const runId = String(run.id);
  await recordEvidence({
    runId,
    tenantId,
    sourceKey,
    sourceType: "CONTROLLED_FALLBACK",
    adapterVersion: "1.0.0",
    normalizedEvidence: {
      authoritativeSearchCompleted: false,
      failureCode,
      failureDetail,
      claimImpact: "none",
    },
  });
  await patchRun(runId, tenantId, {
    status: "UNABLE_TO_VERIFY",
    confidence: "LOW",
    source_type: "CONTROLLED_FALLBACK",
    source_reference: null,
    adapter_version: "1.0.0",
    matching_algorithm_version: "1.0.0",
    failure_code: failureCode,
    failure_detail: failureDetail,
    completed_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  });
  await auditCompleted(runId, tenantId, "UNABLE_TO_VERIFY");
}

async function completeSynthetic(run: Row, tenantId: string) {
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

  if (!provider || !plan) {
    await completeUnable(
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
    organizationNpi: organization?.group_npi ?? null,
    planId: plan.id,
    networkId: network?.id ?? null,
    state: location?.state ?? plan.state ?? "CO",
    postalCode: location?.postal_code ?? null,
    taxonomyCode: provider.taxonomy_code ?? null,
    providerNetworkRelationshipConfirmed: true,
    claimImpact: "none",
  };

  await recordEvidence({
    runId,
    tenantId,
    sourceKey: "synthetic",
    sourceType: "SYNTHETIC_TEST_ADAPTER",
    sourceReference: `synthetic:${runId}`,
    adapterVersion: "1.0.0",
    normalizedEvidence: evidence,
  });

  await recordMatches(runId, tenantId, [
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

  await patchRun(runId, tenantId, {
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
  await auditCompleted(runId, tenantId, "PARTICIPATING");
}

async function processMessage(item: QueueMessage) {
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
      await completeSynthetic(run, tenantId);
    } else {
      await completeUnable(
        run,
        tenantId,
        adapterKey || "unconfigured",
        "SOURCE_UNAVAILABLE",
        adapterKey
          ? `Adapter ${adapterKey} is not yet configured for automated plan/network verification.`
          : "No payer adapter is configured for automated plan/network verification.",
      );
    }
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "completed", runId };
  } catch (error) {
    const failureCode = "TRANSIENT_NETWORK";
    const attempts = Math.max(item.read_ct ?? 0, Number(item.message?.attempt ?? 0) + 1);
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
      run,
      tenantId,
      adapterKey || "worker",
      "SOURCE_UNAVAILABLE",
      error instanceof Error ? error.message : "Credentialing source unavailable.",
    );
    await rpc(QUEUE_ARCHIVE_RPC, { p_msg_id: item.msg_id });
    return { status: "completed_unable_to_verify", runId };
  }
}

Deno.serve(async (req: Request) => {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authorization required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (!base || !serviceKey) {
    return new Response(JSON.stringify({ error: "Worker configuration missing" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const rows = (await rpc(QUEUE_READ_RPC)) as QueueMessage[] | null;
  const item = rows?.[0];
  if (!item) {
    return new Response(JSON.stringify({ status: "empty" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const result = await processMessage(item);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
});
