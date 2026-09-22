import { referenceSelect, tenantSelect, type Row } from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

export async function getCms1500PreviewData(claimId: string) {
  const claims = await tenantSelect<DataRow>("professional_claims", {
    id: `eq.${claimId}`,
    limit: "1",
  });
  const claim = first(claims);
  if (!claim) throw new Error("Claim not found.");

  const [
    clients,
    renderingProviders,
    billingProviders,
    payers,
    insurancePolicies,
    practiceEntities,
    practiceLocations,
    lines,
    diagnoses,
  ] = await Promise.all([
    tenantSelect<DataRow>("clients", { id: `eq.${String(claim.client_id)}`, limit: "1" }),
    claim.rendering_provider_id
      ? tenantSelect<DataRow>("providers", { id: `eq.${String(claim.rendering_provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    claim.billing_provider_id
      ? tenantSelect<DataRow>("providers", { id: `eq.${String(claim.billing_provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    claim.payer_id
      ? referenceSelect<DataRow>("payers", { id: `eq.${String(claim.payer_id)}`, limit: "1" })
      : Promise.resolve([]),
    claim.payer_id
      ? tenantSelect<DataRow>("client_insurance_policies", {
          client_id: `eq.${String(claim.client_id)}`,
          payer_id: `eq.${String(claim.payer_id)}`,
          order: "effective_date.desc,created_at.desc",
        })
      : Promise.resolve([]),
    tenantSelect<DataRow>("practice_entities", { status: "eq.active", order: "created_at.asc" }),
    tenantSelect<DataRow>("practice_locations", { status: "eq.active", order: "is_primary.desc,created_at.asc" }),
    tenantSelect<DataRow>("professional_claim_lines", {
      claim_id: `eq.${claimId}`,
      order: "service_date.asc,created_at.asc",
    }),
    tenantSelect<DataRow>("claim_diagnoses", {
      claim_id: `eq.${claimId}`,
      order: "pointer_order.asc",
    }),
  ]);

  const client = first(clients);
  const renderingProvider = first(renderingProviders);
  const billingProvider = first(billingProviders);
  const payer = first(payers);

  return {
    claim: {
      ...claim,
      clientName: client ? [client.first_name, client.last_name].filter(Boolean).join(" ") : "—",
      providerName: renderingProvider ? [renderingProvider.first_name, renderingProvider.last_name].filter(Boolean).join(" ") : "—",
      payerName: String(payer?.name ?? "—"),
    },
    client,
    insurancePolicy: first(insurancePolicies),
    renderingProvider,
    billingProvider,
    practiceEntity: first(practiceEntities),
    practiceLocation: first(practiceLocations),
    lines,
    diagnoses,
  };
}
