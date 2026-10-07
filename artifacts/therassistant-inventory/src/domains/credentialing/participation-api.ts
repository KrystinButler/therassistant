import { authenticatedFetch } from "../../lib/supabase-client";

export type CatalogPayer = {
  id: string;
  name: string;
  adapterKey: string | null;
  active: boolean;
};

export type CatalogPlan = {
  id: string;
  payerId: string;
  name: string;
  productType: string | null;
  marketSegment: string | null;
  active: boolean;
};

export type CatalogNetwork = {
  id: string;
  planId: string;
  name: string;
  active: boolean;
};

export type VerificationCreateInput = {
  provider_id: string;
  organization_id?: string | null;
  practice_location_id?: string | null;
  payer_id: string;
  plan_id: string;
  network_id?: string | null;
};

export type VerificationResult = Record<string, any> & {
  id?: string;
  verificationId?: string;
  status: "IN_PROGRESS" | "PARTICIPATING" | "NOT_FOUND" | "UNABLE_TO_VERIFY";
  confidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  source_updated_at?: string | null;
  source_reference?: string | null;
  verified_at?: string | null;
  failure_code?: string | null;
  failure_detail?: string | null;
  evidence?: Array<Record<string, any>>;
  matches?: Array<Record<string, any>>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(
        (payload as Record<string, unknown>)?.error ??
          `Credentialing API request failed (${response.status}).`,
      ),
    );
  }
  return payload as T;
}

export function loadPayers() {
  return api<CatalogPayer[]>("/api/v1/payers");
}

export function loadPlans(payerId: string) {
  return api<CatalogPlan[]>(`/api/v1/payers/${encodeURIComponent(payerId)}/plans`);
}

export function loadNetworks(planId: string) {
  return api<CatalogNetwork[]>(`/api/v1/plans/${encodeURIComponent(planId)}/networks`);
}

export function createParticipationVerification(input: VerificationCreateInput) {
  return api<{ verificationId: string; status: "IN_PROGRESS" }>(
    "/api/v1/participation-verifications",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function loadParticipationVerification(verificationId: string) {
  return api<VerificationResult>(
    `/api/v1/participation-verifications/${encodeURIComponent(verificationId)}`,
  );
}

export function loadVerificationHistory(providerId: string) {
  return api<VerificationResult[]>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/verification-history`,
  );
}

export async function pollParticipationVerification(
  verificationId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<VerificationResult> {
  const intervalMs = options.intervalMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const result = await loadParticipationVerification(verificationId);
    if (result.status !== "IN_PROGRESS") return result;
    if (Date.now() >= deadline) {
      return result;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
