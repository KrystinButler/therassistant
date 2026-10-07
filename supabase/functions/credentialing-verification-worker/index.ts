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

async function credentialing_internal_secret_valid(value: string | null) {
  if (!value || !base || !serviceKey) return false;
  const response = await fetch(`${base}/rest/v1/rpc/credentialing_internal_secret_valid`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_secret: value }),
  });
  return response.ok && (await response.json()) === true;
}

Deno.serve(async (req: Request) => {
  if (!base || !serviceKey) {
    return new Response(JSON.stringify({ error: "Worker configuration missing" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const schedulerSecret = req.headers.get("x-therassistant-scheduler-secret");
  if (!(await credentialing_internal_secret_valid(schedulerSecret))) {
    return new Response(JSON.stringify({ error: "Unauthorized maintenance request" }), {
      status: 401,
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
