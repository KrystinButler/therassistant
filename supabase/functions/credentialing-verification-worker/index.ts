import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleVerificationWorker } from "./processor.ts";

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

  try {
    const result = await handleVerificationWorker({ base, serviceKey });
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Credentialing verification worker failed",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});
