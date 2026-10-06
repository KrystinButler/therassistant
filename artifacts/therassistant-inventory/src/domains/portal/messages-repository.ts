import { getCurrentTenantId, tenantRpc } from "../../lib/tenant-data-client";
import { portalRpc } from "./portal-client";

export type PortalMessage = {
  id: string;
  sender_type: "patient" | "staff";
  body: string;
  created_at: string;
};

export type PortalMessageThread = {
  id: string;
  subject: string;
  status: "open" | "closed";
  last_message_at: string;
  closed_at?: string | null;
  created_at: string;
  messages: PortalMessage[];
};

type PortalMessagePayload = {
  threads?: PortalMessageThread[] | null;
};

function normalize(payload: PortalMessagePayload | null | undefined) {
  return payload?.threads ?? [];
}

export async function getMyPortalMessages() {
  return normalize(await portalRpc<PortalMessagePayload>("get_my_portal_messages"));
}

export function sendMyPortalMessage(input: {
  threadId?: string | null;
  subject?: string | null;
  body: string;
}) {
  return portalRpc<{ thread_id: string; status: string; last_message_at: string }>("portal_send_message", {
    p_thread_id: input.threadId ?? null,
    p_subject: input.subject ?? null,
    p_body: input.body,
  });
}

export async function getClientPortalMessages(clientId: string) {
  if (!clientId) throw new Error("Patient ID is required.");
  const tenantId = await getCurrentTenantId();
  return normalize(await tenantRpc<PortalMessagePayload>("get_client_portal_messages", {
    p_tenant_id: tenantId,
    p_client_id: clientId,
  }));
}

export async function replyClientPortalMessage(threadId: string, body: string) {
  if (!threadId) throw new Error("Message thread is required.");
  const tenantId = await getCurrentTenantId();
  return tenantRpc<{ id: string; thread_id: string; sender_type: string; body: string; created_at: string }>(
    "reply_client_portal_message",
    {
      p_tenant_id: tenantId,
      p_thread_id: threadId,
      p_body: body,
    },
  );
}

export async function closeClientPortalMessageThread(threadId: string, note?: string) {
  if (!threadId) throw new Error("Message thread is required.");
  const tenantId = await getCurrentTenantId();
  return tenantRpc<{ thread_id: string; status: string; closed_at: string | null }>(
    "close_client_portal_message_thread",
    {
      p_tenant_id: tenantId,
      p_thread_id: threadId,
      p_note: note ?? null,
    },
  );
}
