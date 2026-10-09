import { withSupabase } from "npm:@supabase/server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const transactions = {
  "837P": { pathEnv: "OFFICE_ALLY_837P_PATH", methodEnv: "OFFICE_ALLY_837P_METHOD" },
  "270/271": { pathEnv: "OFFICE_ALLY_270_271_PATH", methodEnv: "OFFICE_ALLY_270_271_METHOD" },
  "276/277": { pathEnv: "OFFICE_ALLY_276_277_PATH", methodEnv: "OFFICE_ALLY_276_277_METHOD" },
  "835": { pathEnv: "OFFICE_ALLY_835_PATH", methodEnv: "OFFICE_ALLY_835_METHOD" },
} as const;

type Transaction = keyof typeof transactions;
type JsonRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function scalar(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function configuredRoute(transaction: Transaction) {
  const config = transactions[transaction];
  const baseUrl = (Deno.env.get("OFFICE_ALLY_API_BASE_URL") || "https://edi.officeally.io").replace(/\/$/, "");
  const path = String(Deno.env.get(config.pathEnv) || "").trim();
  const method = String(Deno.env.get(config.methodEnv) || "").trim().toUpperCase();

  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Office Ally transaction routing is not configured on the platform.");
  }
  if (method !== "GET" && method !== "POST") {
    throw new Error("Office Ally transaction method is not configured on the platform.");
  }
  return { url: new URL(baseUrl + path), method };
}

async function activeTenantMembership(ctx: any, tenantId: string) {
  const userId = String(ctx.userClaims?.sub ?? "");
  if (!userId || !tenantId) return false;
  const { data, error } = await ctx.supabaseAdmin
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  if (error) throw new Error("Unable to verify organization access.");
  return Boolean(data?.length);
}

function upstreamHeaders() {
  const authHeader = String(Deno.env.get("OFFICE_ALLY_AUTH_HEADER") || "").trim();
  const authValue = String(Deno.env.get("OFFICE_ALLY_AUTH_VALUE") || "").trim();
  if (!authHeader || !authValue) {
    throw new Error("Office Ally credentials are not configured on the platform.");
  }

  const headers = new Headers({
    Accept: "application/json, application/edi-x12, text/plain, */*",
    "Content-Type": Deno.env.get("OFFICE_ALLY_CONTENT_TYPE") || "application/json",
  });
  headers.set(authHeader, authValue);
  return headers;
}

const secured = withSupabase({ auth: "user" }, async (req, ctx) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const body = record(await req.json().catch(() => ({})));
    const tenantId = String(body.tenantId ?? "").trim();
    const transaction = String(body.transaction ?? "") as Transaction;
    const payload = record(body.payload);

    if (!(transaction in transactions)) {
      return json({ error: "Unsupported Office Ally transaction." }, 400);
    }
    if (!tenantId) return json({ error: "Organization context is required." }, 400);
    if (!(await activeTenantMembership(ctx, tenantId))) {
      return json({ error: "Active organization access is required." }, 403);
    }

    const route = configuredRoute(transaction);
    const headers = upstreamHeaders();
    const init: RequestInit = { method: route.method, headers };

    if (route.method === "GET") {
      for (const [key, value] of Object.entries(payload)) {
        if (scalar(value)) route.url.searchParams.set(key, String(value));
      }
    } else {
      init.body = JSON.stringify(payload);
    }

    const upstream = await fetch(route.url, init);
    const contentType = upstream.headers.get("content-type") || "";
    const data = contentType.includes("json")
      ? await upstream.json().catch(() => ({}))
      : await upstream.text();

    if (!upstream.ok) {
      return json({
        ok: false,
        transaction,
        error: "Office Ally rejected the transaction.",
        upstreamStatus: upstream.status,
        data,
      }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }

    return json({
      ok: true,
      transaction,
      upstreamStatus: upstream.status,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Office Ally gateway error.";
    const configurationError = message.includes("not configured on the platform");
    return json({ error: message }, configurationError ? 503 : 500);
  }
});

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return secured(req);
});
