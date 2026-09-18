import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type PortalRow = Record<string, unknown>;

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

async function request<T>(
  label: string,
  url: URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  const response = await authenticatedFetch(url, {
    ...init,
    headers,
  });

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
      `Patient portal ${label} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return (body ? JSON.parse(body) : null) as T;
}

export async function portalSelect<T extends PortalRow>(
  table: string,
  filters: Record<string, string> = {},
) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  return request<T[]>(table, url);
}

export function portalRpc<T>(
  functionName: string,
  args: PortalRow = {},
): Promise<T> {
  return request<T>(
    `rpc/${functionName}`,
    new URL(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`),
    {
      method: "POST",
      body: JSON.stringify(args),
    },
  );
}

export function getMyPortalContext() {
  return portalRpc<PatientPortalContext | null>("get_my_client_portal_context");
}

export function activateMyPortalAccess() {
  return portalRpc<Pick<PatientPortalContext, "tenant_id" | "client_id" | "status" | "activated_at">>(
    "activate_my_client_portal_access",
  );
}
