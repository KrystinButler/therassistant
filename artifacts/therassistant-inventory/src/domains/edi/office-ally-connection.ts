import {
  authenticatedFetch,
  SUPABASE_URL,
} from "../../lib/supabase-client";
import { requireActiveTenantId } from "../../lib/tenant-session";

export type OfficeAllyConnectionEnvironment = "test" | "production";
export type OfficeAllyConnectionStatusCode =
  | "not_connected"
  | "test_ready"
  | "production_connected"
  | "connection_error";

export type OfficeAllyConnectionStatus = {
  provider: "office_ally";
  environment: OfficeAllyConnectionEnvironment;
  status: OfficeAllyConnectionStatusCode;
  account_label: string | null;
  credential_profile: string | null;
  last_verified_at: string | null;
  last_error: string | null;
};

const CREDENTIAL_PROFILE = "authorization_api_key";

function rpcUrl(name: string) {
  return `${SUPABASE_URL}/rest/v1/rpc/${name}`;
}

function normalizeStatus(payload: unknown): OfficeAllyConnectionStatus {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Office Ally connection status is unavailable.");
  }
  return row as OfficeAllyConnectionStatus;
}

async function callStatusRpc(name: string, body: Record<string, unknown>) {
  const response = await authenticatedFetch(rpcUrl(name), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload && typeof payload === "object" && !Array.isArray(payload)
      ? String((payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error ?? "")
      : "";
    throw new Error(error || `Office Ally connection request failed (${response.status}).`);
  }
  return normalizeStatus(payload);
}

export function getOfficeAllyConnectionStatus() {
  return callStatusRpc("get_office_ally_connection_status", {
    p_tenant_id: requireActiveTenantId(),
  });
}

export function saveOfficeAllyTestConnection(accountLabel = "THERASSISTANT Test") {
  return callStatusRpc("save_office_ally_connection", {
    p_tenant_id: requireActiveTenantId(),
    p_environment: "test",
    p_account_label: accountLabel,
    p_credential_profile: null,
    p_credentials: {},
  });
}

export function saveOfficeAllyProductionConnection(input: {
  apiKey: string;
  accountLabel?: string;
}) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("Office Ally API Key is required.");
  return callStatusRpc("save_office_ally_connection", {
    p_tenant_id: requireActiveTenantId(),
    p_environment: "production",
    p_account_label: input.accountLabel?.trim() || null,
    p_credential_profile: CREDENTIAL_PROFILE,
    p_credentials: { apiKey },
  });
}

export function disconnectOfficeAllyConnection() {
  return callStatusRpc("disconnect_office_ally_connection", {
    p_tenant_id: requireActiveTenantId(),
  });
}
