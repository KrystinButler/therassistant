import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { requireActiveTenantId } from "../../lib/tenant-session";

export const OFFICE_ALLY_TRANSACTIONS = ["837P", "270/271", "276/277", "835"] as const;
export type OfficeAllyTransaction = (typeof OFFICE_ALLY_TRANSACTIONS)[number];

/**
 * Office Ally is a THERASSISTANT platform integration. Practices never enter
 * clearinghouse credentials, choose a clearinghouse, or maintain API URLs.
 * Payer/trading-partner enrollment can still be required before a payer will
 * accept a given transaction type.
 */
export const PLATFORM_CLEARINGHOUSE = Object.freeze({
  id: "office_ally",
  name: "Office Ally",
  platformManaged: true,
  practiceSetupRequired: false,
  transactions: [...OFFICE_ALLY_TRANSACTIONS],
});

export function officeAllyFunctionUrl(supabaseUrl = SUPABASE_URL) {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/office-ally-edi`;
}

export type OfficeAllyRequest = {
  transaction: OfficeAllyTransaction;
  /** Transaction body/query data only. Never include Office Ally credentials. */
  payload: Record<string, unknown>;
};

export type OfficeAllyResponse<T = unknown> = {
  ok: boolean;
  transaction: OfficeAllyTransaction;
  data?: T;
  error?: string;
  upstreamStatus?: number;
};

export async function sendOfficeAllyTransaction<T = unknown>(
  request: OfficeAllyRequest,
): Promise<OfficeAllyResponse<T>> {
  if (!OFFICE_ALLY_TRANSACTIONS.includes(request.transaction)) {
    throw new Error("Unsupported Office Ally transaction.");
  }

  const response = await authenticatedFetch(officeAllyFunctionUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenantId: requireActiveTenantId(),
      transaction: request.transaction,
      payload: request.payload,
    }),
  });

  const result = (await response.json().catch(() => ({}))) as OfficeAllyResponse<T>;
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Office Ally transaction failed (${response.status}).`);
  }
  return result;
}
