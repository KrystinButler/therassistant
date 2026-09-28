import { importRole, ImportError } from "./service.ts";
import { PractitionerRoleValidationError } from "./normalizer.ts";
const base = Deno.env.get("SUPABASE_URL")!;
function key(current: string, legacy: string) {
  const values = Deno.env.get(current);
  if (values) {
    const parsed = JSON.parse(values);
    return parsed.default ?? (Object.values(parsed)[0] as string);
  }
  return Deno.env.get(legacy)!;
}
const publicKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const secret = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const allowed =
    !origin ||
    origin === "http://127.0.0.1:4173" ||
    origin === "http://localhost:4173" ||
    origin === "https://therassistant.vercel.app" ||
    origin === "https://therassistant-therassistant-1064.vercel.app" ||
    /^https:\/\/therassistant-[a-z0-9-]+-therassistant-1064\.vercel\.app$/.test(
      origin,
    );
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin":
      allowed && origin ? origin : "https://therassistant.vercel.app",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  const failure = (status: number, message: string, field?: string) =>
    respond(
      {
        resourceType: "OperationOutcome",
        issue: [
          {
            severity: "error",
            code:
              status === 403
                ? "forbidden"
                : status === 422
                  ? "invalid"
                  : "processing",
            diagnostics: message,
            ...(field ? { expression: [field] } : {}),
          },
        ],
      },
      status,
    );
  if (!allowed) return failure(403, "Origin is not allowed.");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return failure(405, "Use POST.");
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return failure(401, "Sign in to import provider roles.");
  try {
    const identity = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: authorization },
    });
    if (!identity.ok)
      return failure(401, "Your session is invalid or expired.");
    const user = await identity.json();
    if (!user.id) return failure(401, "A user session is required.");
    // Bound actual bytes, including requests without Content-Length.
    const reader = req.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (!reader) return failure(400, "A JSON body is required.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) {
        await reader.cancel();
        return failure(413, "File must be smaller than 256 KB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return failure(400, "Invalid JSON.");
    }
    async function rest(path: string, body?: unknown, asUser = false) {
      const r = await fetch(`${base}/rest/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          apikey: asUser ? publicKey : secret,
          Authorization: asUser ? authorization! : `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`Database operation failed: ${r.status}`);
      return r.status === 204 ? null : r.json();
    }
    const result = await importRole(input, {
      authorize: (tenant) =>
        rest(
          "rpc/can_import_practitioner_roles",
          { p_tenant_id: tenant },
          true,
        ),
      findProviders: (tenant, npi) =>
        rest(
          `providers?select=id&tenant_id=eq.${encodeURIComponent(tenant)}&individual_npi=eq.${encodeURIComponent(npi)}&limit=2`,
        ),
      save: (row) =>
        rest("rpc/save_practitioner_role_import", {
          p_actor: user.id,
          p_row: row,
        }),
    });
    return respond(result);
  } catch (error) {
    if (error instanceof ImportError)
      return failure(error.status, error.message);
    if (error instanceof PractitionerRoleValidationError)
      return failure(422, error.message, error.field);
    // Do not log provider payloads, tokens, or raw database errors.
    console.error("PractitionerRole import infrastructure failure");
    return failure(
      503,
      "Import service is unavailable. Nothing was confirmed saved; retry is safe.",
    );
  }
});
