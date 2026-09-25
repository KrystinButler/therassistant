import { createClient } from "@supabase/supabase-js";
import {
  decideInviteAction,
  isExistingUserError,
  normalizeInviteRequest,
  type ExistingAccessStatus,
} from "./logic.ts";

type InviteContext = {
  tenant_id?: string | null;
  client_id?: string | null;
  email?: string | null;
  first_name?: string | null;
  access_id?: string | null;
  access_status?: ExistingAccessStatus;
  access_user_id?: string | null;
  access_invited_email?: string | null;
  access_invited_at?: string | null;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function namedKey(currentName: string, legacyName: string) {
  const current = Deno.env.get(currentName)?.trim();
  if (current) {
    try {
      const parsed = JSON.parse(current) as Record<string, unknown>;
      const preferred = parsed.default;
      if (typeof preferred === "string" && preferred.trim()) return preferred.trim();

      const fallback = Object.values(parsed).find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      if (fallback) return fallback.trim();
    } catch {
      throw new Error(`Invalid ${currentName} configuration`);
    }
  }

  const legacy = Deno.env.get(legacyName)?.trim();
  if (legacy) return legacy;

  throw new Error(`Missing Supabase API key configuration: ${currentName}`);
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const PUBLISHABLE_KEY = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SECRET_KEY = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PORTAL_BASE_URL = (Deno.env.get("PORTAL_BASE_URL")?.trim() || "https://therassistant.vercel.app").replace(/\/+$/, "");
const PORTAL_ORIGIN = new URL(PORTAL_BASE_URL).origin;

function corsHeaders(origin = PORTAL_ORIGIN) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigin = !origin || origin === PORTAL_ORIGIN
    || origin === "https://therassistant.vercel.app"
    || origin === "https://therassistant-therassistant-1064.vercel.app"
    || /^https:\/\/therassistant-[a-z0-9-]+-therassistant-1064\.vercel\.app$/.test(origin);
  if (!allowedOrigin) return new Response(JSON.stringify({ error: "Origin is not allowed." }), { status: 403, headers: corsHeaders() });
  const requestOrigin = origin || PORTAL_ORIGIN;
  const json = (payload: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(payload), { status, headers: corsHeaders(requestOrigin) });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(requestOrigin) });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Authentication required." }, 401);
  }

  const userJwt = authorization.slice("Bearer ".length).trim();
  if (!userJwt) {
    return json({ error: "Authentication required." }, 401);
  }

  let clientId: string;
  try {
    ({ clientId } = normalizeInviteRequest(await req.json()));
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Invalid request.",
      },
      400,
    );
  }

  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: staffAuth, error: staffAuthError } =
    await userClient.auth.getUser(userJwt);
  const staffUser = staffAuth.user;

  if (staffAuthError || !staffUser) {
    return json({ error: "Authenticated staff identity is unavailable." }, 401);
  }

  const { data: contextData, error: contextError } = await userClient.rpc(
    "get_patient_portal_invite_context",
    { p_client_id: clientId },
  );

  if (contextError || !contextData) {
    return json(
      { error: "Patient is unavailable for portal enrollment." },
      403,
    );
  }

  const context = contextData as InviteContext;
  const accessStatus = (context.access_status ?? null) as ExistingAccessStatus;
  const email = String(context.email ?? "").trim().toLowerCase();
  const inviteAction = decideInviteAction(accessStatus);

  if (inviteAction === "return-existing") {
    return json(
      {
        client_id: clientId,
        status: accessStatus,
        invited_email: context.access_invited_email ?? null,
        invited_at: context.access_invited_at ?? null,
      },
      200,
    );
  }

  if (inviteAction === "block-revoked") {
    return json(
      {
        error:
          "Patient portal access was revoked. Automatic re-enrollment is not supported in this release.",
      },
      409,
    );
  }

  if (!email) {
    return json(
      { error: "Patient email is required before portal enrollment." },
      422,
    );
  }

  const admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const redirectTo = `${PORTAL_BASE_URL}/patient-portal/activate`;
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name: context.first_name ?? null },
    });

  if (inviteError || !invited.user) {
    const duplicate = isExistingUserError(inviteError?.message, inviteError?.code);

    if (duplicate) {
      const { data: latestContext } = await userClient.rpc(
        "get_patient_portal_invite_context",
        { p_client_id: clientId },
      );
      const latest = latestContext as InviteContext | null;
      if (latest?.access_status === "active" || latest?.access_status === "invited") {
        return json(
          {
            client_id: clientId,
            status: latest.access_status,
            invited_email: latest.access_invited_email ?? null,
            invited_at: latest.access_invited_at ?? null,
          },
          200,
        );
      }
    }

    return json(
      {
        error: duplicate
          ? "An account already exists for this email. If it is a staff login, save a separate patient email and press Send Portal Invite again. Existing nonstaff accounts require verified patient enrollment; accounts are never linked automatically."
          : inviteError?.message ?? "Unable to send patient portal invitation.",
        ...(duplicate ? { code: "existing_auth_account", action: "staff_identity_review" } : {}),
      },
      duplicate ? 409 : 502,
    );
  }

  const invitedAt = new Date().toISOString();
  const { error: mappingError } = await admin
    .from("client_portal_access")
    .insert({
      tenant_id: context.tenant_id,
      client_id: clientId,
      user_id: invited.user.id,
      relationship: "self",
      status: "invited",
      invited_email: email,
      invited_at: invitedAt,
      created_by: staffUser.id,
    });

  if (mappingError) {
    let cleanupError: unknown = null;
    try {
      const cleanup = await admin.auth.admin.deleteUser(invited.user.id);
      cleanupError = cleanup.error ?? null;
    } catch (error) {
      cleanupError = error;
    }

    if (cleanupError) {
      return json(
        {
          error:
            "Portal mapping failed and automatic Auth cleanup did not complete. Administrator action is required before retrying enrollment.",
        },
        500,
      );
    }

    return json(
      {
        error:
          "Invitation could not be linked to the patient. No portal access was created.",
      },
      502,
    );
  }

  return json(
    {
      client_id: clientId,
      status: "invited",
      invited_email: email,
      invited_at: invitedAt,
    },
    201,
  );
});
