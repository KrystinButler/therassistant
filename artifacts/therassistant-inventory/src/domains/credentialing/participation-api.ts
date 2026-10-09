import { getCurrentTenantId, referenceSelect, tenantRpc, tenantSelect } from "../../lib/tenant-data-client";

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

function activeCatalogFilters() {
  const today = new Date().toISOString().slice(0, 10);
  return { active: "eq.true", and: `(or(effective_from.is.null,effective_from.lte.${today}),or(effective_to.is.null,effective_to.gte.${today}))`, order: "name.asc" };
}
export function loadPayers() {
  return referenceSelect<CatalogPayer>("payers", { ...activeCatalogFilters(), select: "id,name,adapterKey:adapter_key,active" });
}
export function loadPlans(payerId: string) {
  return referenceSelect<CatalogPlan>("payer_plans", { ...activeCatalogFilters(), payer_id: `eq.${payerId}`, state: "eq.CO", select: "id,payerId:payer_id,name,productType:product_type,marketSegment:market_segment,active" });
}
export function loadNetworks(planId: string) {
  return referenceSelect<CatalogNetwork>("payer_networks", { ...activeCatalogFilters(), plan_id: `eq.${planId}`, select: "id,planId:plan_id,name,active" });
}
export async function createParticipationVerification(input: VerificationCreateInput) {
  return tenantRpc<{verificationId:string;status:"IN_PROGRESS"}>("request_participation_verification", {
    p_tenant_id: await getCurrentTenantId(), p_provider_id: input.provider_id,
    p_payer_id: input.payer_id, p_plan_id: input.plan_id,
    p_network_id: input.network_id ?? null, p_organization_id: input.organization_id ?? null,
    p_practice_location_id: input.practice_location_id ?? null,
  });
}
export async function loadParticipationVerification(verificationId: string) {
  const [runs, evidence, matches] = await Promise.all([
    tenantSelect<VerificationResult>("participation_verification_runs", {id: `eq.${verificationId}`, limit:"1"}),
    tenantSelect("participation_verification_evidence", {verification_id: `eq.${verificationId}`, order:"retrieved_at.asc,created_at.asc"}),
    tenantSelect("participation_verification_matches", {verification_id: `eq.${verificationId}`, order:"created_at.asc,match_type.asc"}),
  ]);
  if (!runs[0]) throw new Error("Verification was not found in this practice.");
  return {...runs[0], evidence, matches};
}
export function loadVerificationHistory(providerId: string) {
  return tenantSelect<VerificationResult>("participation_verification_runs", {provider_id:`eq.${providerId}`,order:"requested_at.desc",limit:"200"});
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
