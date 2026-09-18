import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type PatientPortalContext = {
  tenant_id: string;
  client_id: string;
  status: "invited" | "active" | "revoked";
  relationship: string;
  invited_email: string;
  invited_at?: string | null;
  activated_at?: string | null;
  revoked_at?: string | null;
};

type PortalValue = Record<string, unknown>;

export async function portalRpc<T>(
  functionName: string,
  args: PortalValue = {},
): Promise<T> {
  const response = await authenticatedFetch(
    `${SUPABASE_URL}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    let detail = body;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      detail = String(parsed.message ?? parsed.error ?? body);
    } catch {
      // Keep the raw response body when PostgREST did not return JSON.
    }
    throw new Error(
      `Patient portal request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return (body ? JSON.parse(body) : null) as T;
}

export function getMyPortalContext() {
  return portalRpc<PatientPortalContext | null>("get_my_client_portal_context");
}

export function activateMyPortalAccess() {
  return portalRpc<Pick<PatientPortalContext, "tenant_id" | "client_id" | "status" | "activated_at">>(
    "activate_my_client_portal_access",
  );
}
