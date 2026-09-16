import { demoSelect, demoUpdate, referenceSelect, type Row } from "../../lib/supabase-demo-client";

type DataRow = Row & { id: string };
export type ClaimIdentityValues = { client_id: string; payer_id: string; rendering_provider_id: string };

export async function getClaimWorkReferenceData() {
  const [clients, providers, payers] = await Promise.all([
    demoSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    demoSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
  ]);
  return { clients, providers, payers };
}

export function saveClaimIdentityFields(claimId: string, values: ClaimIdentityValues) {
  return demoUpdate<DataRow>("professional_claims", claimId, {
    client_id: values.client_id || null,
    payer_id: values.payer_id || null,
    rendering_provider_id: values.rendering_provider_id || null,
  });
}
