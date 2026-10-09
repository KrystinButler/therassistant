import { withSupabase } from "npm:@supabase/server";
import {
  resolveOfficeAllyConnection,
  type OfficeAllyEnvironment,
} from "../_shared/office-ally-connection.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const transactions = {
  "837P": {
    pathEnv: "OFFICE_ALLY_837P_PATH",
    methodEnv: "OFFICE_ALLY_837P_METHOD",
    defaultPath: "",
    defaultMethod: "",
  },
  "270/271": {
    pathEnv: "OFFICE_ALLY_270_271_PATH",
    methodEnv: "OFFICE_ALLY_270_271_METHOD",
    defaultPath: "/v2/eligibility",
    defaultMethod: "POST",
  },
  "276/277": {
    pathEnv: "OFFICE_ALLY_276_277_PATH",
    methodEnv: "OFFICE_ALLY_276_277_METHOD",
    defaultPath: "/v2/claim-status",
    defaultMethod: "POST",
  },
  "835": {
    pathEnv: "OFFICE_ALLY_835_PATH",
    methodEnv: "OFFICE_ALLY_835_METHOD",
    defaultPath: "",
    defaultMethod: "",
  },
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
  const path = String(Deno.env.get(config.pathEnv) || config.defaultPath).trim();
  const method = String(Deno.env.get(config.methodEnv) || config.defaultMethod).trim().toUpperCase();

  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Office Ally ${transaction} routing is not configured on the platform.`);
  }
  if (method !== "GET" && method !== "POST") {
    throw new Error(`Office Ally ${transaction} method is not configured on the platform.`);
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

function productionHeaders(apiKey: string) {
  const headers = new Headers({
    Accept: "application/json, application/edi-x12, text/plain, */*",
    "Content-Type": Deno.env.get("OFFICE_ALLY_CONTENT_TYPE") || "application/json",
  });
  headers.set("Authorization", apiKey);
  return headers;
}

function syntheticTransactionData(transaction: Transaction) {
  switch (transaction) {
    case "837P":
      return {
        acknowledgement: "accepted_for_test",
        submissionReference: "TEST-837P-ACK",
      };
    case "270/271":
      return {
        eligibilityStatus: "active",
        responseSource: "therassistant_synthetic_271",
      };
    case "276/277":
      return {
        claimStatus: "accepted_for_test",
        responseSource: "therassistant_synthetic_277",
      };
    case "835":
      return {
        available: true,
        responseSource: "therassistant_synthetic_835",
      };
  }
}

const secured = withSupabase({ auth: "user" }, async (req, ctx) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const body = record(await req.json().catch(() => ({})));
    const tenantId = String(body.tenantId ?? "").trim();
    const environment = String(body.environment ?? "").trim() as OfficeAllyEnvironment;
    const transaction = String(body.transaction ?? "") as Transaction;
    const payload = record(body.payload);

    if (!(transaction in transactions)) {
      return json({ error: "Unsupported Office Ally transaction." }, 400);
    }
    if (environment !== "test" && environment !== "production") {
      return json({ error: "Office Ally environment must be test or production." }, 400);
    }
    if (!tenantId) return json({ error: "Organization context is required." }, 400);
    if (!(await activeTenantMembership(ctx, tenantId))) {
      return json({ error: "Active organization access is required." }, 403);
    }

    if (environment === "test") {
      return json({
        ok: true,
        environment,
        transaction,
        synthetic: true,
        data: syntheticTransactionData(transaction),
      });
    }

    const connection = await resolveOfficeAllyConnection(ctx, tenantId, environment);
    if (connection.environment !== "production") {
      throw new Error("Office Ally production connection could not be resolved.");
    }

    const route = configuredRoute(transaction);
    const headers = productionHeaders(connection.apiKey);
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
        environment,
        transaction,
        synthetic: false,
        error: "Office Ally rejected the transaction.",
        upstreamStatus: upstream.status,
        data,
      }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }

    return json({
      ok: true,
      environment,
      transaction,
      synthetic: false,
      upstreamStatus: upstream.status,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Office Ally gateway error.";
    const unavailable = /not configured|not connected|not supported|missing/i.test(message);
    return json({ error: message }, unavailable ? 503 : 500);
  }
});

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return secured(req);
});
