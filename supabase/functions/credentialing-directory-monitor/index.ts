import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
type Row = Record<string, any>;

function dbHeaders(extra: HeadersInit = {}) {
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
    headers: dbHeaders(init.headers),
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function validSchedulerSecret(value: string | null) {
  if (!value) return false;
  const result = (await rest("rpc/credentialing_internal_secret_valid", {
    method: "POST",
    body: JSON.stringify({ p_secret: value }),
  })) as boolean;
  return result === true;
}

async function lookupNppes(npi: string) {
  const checkedAt = new Date().toISOString();
  const url = new URL("https://npiregistry.cms.hhs.gov/api/");
  url.searchParams.set("version", "2.1");
  url.searchParams.set("number", npi);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return { directoryStatus: "source_unavailable", checkedAt, raw: { httpStatus: response.status } };
    }
    const body = await response.json() as Row;
    const matches = Array.isArray(body.results)
      ? body.results.filter((row: Row) => String(row.number ?? "") === npi)
      : [];
    if (!matches.length) {
      return { directoryStatus: "not_found", checkedAt, raw: body };
    }
    const row = matches[0] as Row;
    const address = (row.addresses ?? []).find((item: Row) => item.address_purpose === "LOCATION") ?? row.addresses?.[0];
    const taxonomy = (row.taxonomies ?? []).find((item: Row) => item.primary) ?? row.taxonomies?.[0];
    const providerName = row.basic?.organization_name || [row.basic?.first_name, row.basic?.last_name].filter(Boolean).join(" ") || null;
    const locationText = address
      ? [address.address_1, address.address_2, address.city, address.state, address.postal_code].filter(Boolean).join(", ")
      : null;
    return {
      directoryStatus: matches.length > 1 ? "multiple_matches" : "found",
      providerName,
      specialtyText: taxonomy?.desc ?? taxonomy?.code ?? null,
      locationText,
      sourceUpdatedAt: row.basic?.last_updated ?? null,
      checkedAt,
      raw: body,
    };
  } catch (error) {
    return {
      directoryStatus: "source_unavailable",
      checkedAt,
      raw: { error: error instanceof Error ? error.message : "NPPES lookup failed" },
    };
  }
}

async function refreshProvider(provider: Row, expectations: Row[]) {
  const npi = String(provider.individual_npi ?? "").trim();
  if (!/^\d{10}$/.test(npi)) return { skipped: true };

  const observation = await lookupNppes(npi);
  const snapshotRows = (await rest("credentialing_directory_snapshots?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      tenant_id: provider.tenant_id,
      provider_id: provider.id,
      payer_id: null,
      expectation_id: null,
      source_key: "nppes",
      source_record_id: npi,
      directory_status: observation.directoryStatus,
      provider_npi: npi,
      provider_name: observation.providerName ?? null,
      specialty_text: observation.specialtyText ?? null,
      location_text: observation.locationText ?? null,
      network_text: null,
      source_updated_at: observation.sourceUpdatedAt ?? null,
      checked_at: observation.checkedAt,
      raw_result: observation.raw,
    }),
  })) as Row[];
  const snapshotId = String(snapshotRows[0].id);

  for (const expectation of expectations.filter((row) => row.provider_id === provider.id)) {
    const open = (await rest(
      `credentialing_directory_discrepancies?tenant_id=eq.${encodeURIComponent(provider.tenant_id)}&expectation_id=eq.${encodeURIComponent(expectation.id)}&source_key=eq.nppes&status=eq.open&select=id&limit=1`,
    )) as Row[];

    const mismatch = expectation.expected_participation === true && observation.directoryStatus === "not_found";
    if (mismatch) {
      const payload = {
        snapshot_id: snapshotId,
        last_detected_at: observation.checkedAt,
        summary: "Provider expected in public NPPES source was not found by exact NPI.",
        details: { npi, directoryStatus: observation.directoryStatus },
      };
      if (open[0]?.id) {
        await rest(`credentialing_directory_discrepancies?id=eq.${encodeURIComponent(open[0].id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(payload),
        });
      } else {
        await rest("credentialing_directory_discrepancies", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            tenant_id: provider.tenant_id,
            provider_id: provider.id,
            payer_id: expectation.payer_id ?? null,
            expectation_id: expectation.id,
            snapshot_id: snapshotId,
            source_key: "nppes",
            discrepancy_type: "expected_directory_record_missing",
            status: "open",
            summary: payload.summary,
            details: payload.details,
            first_detected_at: observation.checkedAt,
            last_detected_at: observation.checkedAt,
          }),
        });
      }
    } else if (open[0]?.id && observation.directoryStatus === "found") {
      await rest(`credentialing_directory_discrepancies?id=eq.${encodeURIComponent(open[0].id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "resolved",
          reviewed_at: observation.checkedAt,
          resolution_notes: "Automatically resolved after a later exact-NPI NPPES refresh found the provider.",
          last_detected_at: observation.checkedAt,
        }),
      });
    }
  }

  return { snapshotId, status: observation.directoryStatus };
}

Deno.serve(async (req: Request) => {
  if (!base || !serviceKey) {
    return new Response(JSON.stringify({ error: "Directory monitor configuration missing" }), { status: 500 });
  }
  const schedulerSecret = req.headers.get("x-therassistant-scheduler-secret");
  if (!(await validSchedulerSecret(schedulerSecret))) {
    return new Response(JSON.stringify({ error: "Unauthorized maintenance request" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  try {
    const [providers, expectations] = await Promise.all([
      rest("providers?select=id,tenant_id,individual_npi,provider_status&provider_status=neq.inactive&limit=1000") as Promise<Row[]>,
      rest("credentialing_directory_expectations?select=id,tenant_id,provider_id,payer_id,source_key,expected_participation&source_key=eq.nppes&active=eq.true&limit=2000") as Promise<Row[]>,
    ]);
    let refreshed = 0;
    let skipped = 0;
    for (const provider of providers) {
      const result = await refreshProvider(provider, expectations);
      if (result.skipped) skipped += 1;
      else refreshed += 1;
    }
    return new Response(JSON.stringify({ refreshed, skipped, source: "nppes" }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Directory monitor failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
