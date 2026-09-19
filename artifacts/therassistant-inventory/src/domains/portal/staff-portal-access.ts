import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import {
  tenantRpc,
  tenantSelect,
  type Row,
} from "../../lib/tenant-data-client";

export type ClientPortalAccess = Row & {
  id: string;
  client_id: string;
  status: "invited" | "active" | "revoked";
  invited_email: string;
  invited_at?: string | null;
  activated_at?: string | null;
  revoked_at?: string | null;
};

export async function getClientPortalAccess(clientId: string) {
  const rows = await tenantSelect<ClientPortalAccess>("client_portal_access", {
    client_id: `eq.${clientId}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function invitePatientPortal(clientId: string) {
  const response = await authenticatedFetch(
    `${SUPABASE_URL}/functions/v1/invite-patient-portal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Unable to send patient portal invitation."),
    );
  }
  return payload;
}

export function revokeClientPortalAccess(clientId: string) {
  return tenantRpc<Record<string, unknown>>("revoke_client_portal_access", {
    p_client_id: clientId,
  });
}
