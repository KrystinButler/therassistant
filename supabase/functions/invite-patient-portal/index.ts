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
const PORTAL_BASE_URL = requiredEnv("PORTAL_BASE_URL").replace(/\/+$/, "");
const PORTAL_ORIGIN = new URL(PORTAL_BASE_URL).origin;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": PORTAL_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(),
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== PORTAL_ORIGIN) {
    return json({ error: "Origin is not allowed." }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
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
  let restoreRevoked = false;
  try {
    ({ clientId, restoreRevoked } = normalizeInviteRequest(await req.json()));
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
  const inviteAction = decideInviteAction(accessStatus, restoreRevoked);

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
          "Patient portal access is revoked. Use the explicit restore action to restore the existing portal identity.",
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

  if (inviteAction === "restore-revoked") {
    const accessId = String(context.access_id ?? "").trim();
    const accessUserId = String(context.access_user_id ?? "").trim();
    const invitedEmail = String(context.access_invited_email ?? "").trim().toLowerCase();

    if (!accessId || !accessUserId || !invitedEmail) {
      return json(
        { error: "The revoked portal identity is incomplete and cannot be restored automatically." },
        409,
      );
    }

    if (email !== invitedEmail) {
      return json(
        {
          error:
            "The patient email no longer matches the established portal identity. Update the portal identity through an administrator workflow instead of relinking automatically.",
        },
        409,
      );
    }

    const { data: linkedUser, error: linkedUserError } =
      await admin.auth.admin.getUserById(accessUserId);

    if (linkedUserError || !linkedUser.user) {
      return json(
        {
          error:
            "The original portal Auth identity no longer exists. Administrator action is required before restoring access.",
        },
        409,
      );
    }

    if (String(linkedUser.user.email ?? "").trim().toLowerCase() !== invitedEmail) {
      return json(
        {
          error:
            "The stored portal email does not match the linked Auth identity. Access was not restored.",
        },
        409,
      );
    }

    const restoredAt = new Date().toISOString();
    const { data: restored, error: restoreError } = await admin
      .from("client_portal_access")
      .update({
        status: "active",
        revoked_at: null,
        updated_at: restoredAt,
      })
      .eq("id", accessId)
      .eq("client_id", clientId)
      .eq("user_id", accessUserId)
      .eq("status", "revoked")
      .select("client_id,status,invited_email,activated_at")
      .single();

    if (restoreError || !restored) {
      return json(
        { error: "Portal access could not be restored. No access change was made." },
        409,
      );
    }

    return json(
      {
        client_id: clientId,
        status: "active",
        invited_email: invitedEmail,
        restored_at: restoredAt,
      },
      200,
    );
  }

  const redirectTo = `${PORTAL_BASE_URL}/patient-portal/activate`;
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name: context.first_name ?? null },
    });

  if (inviteError || !invited.user) {
    const duplicate = isExistingUserError(inviteError?.message);

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
          ? "An Auth account already exists for this email. It was not linked automatically."
          : inviteError?.message ?? "Unable to send patient portal invitation.",
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
