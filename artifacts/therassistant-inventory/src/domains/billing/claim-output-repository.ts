import {
  getCurrentTenantId,
  referenceSelect,
  tenantSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { getClaimSubmissionData } from "../claims/repository";
import type {
  BatchOutputData,
  ClaimOutputItem,
  Edi837PConfig,
} from "./claim-output";

type DataRow = Row & { id: string };

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringMap(value: unknown) {
  const source = record(value);
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, String(item ?? "")]),
  );
}

export function read837PConfig(settings: unknown): Edi837PConfig {
  const root = record(settings);
  const config = record(root.claims_837p);
  return {
    submitterName: String(config.submitterName ?? ""),
    submitterId: String(config.submitterId ?? ""),
    receiverName: String(config.receiverName ?? ""),
    receiverId: String(config.receiverId ?? ""),
    contactName: String(config.contactName ?? ""),
    contactPhone: String(config.contactPhone ?? ""),
    contactEmail: String(config.contactEmail ?? ""),
    billingProviderName: String(config.billingProviderName ?? ""),
    billingProviderNpi: String(config.billingProviderNpi ?? ""),
    billingProviderTaxId: String(config.billingProviderTaxId ?? ""),
    billingProviderTaxonomy: String(config.billingProviderTaxonomy ?? ""),
    addressLine1: String(config.addressLine1 ?? ""),
    addressLine2: String(config.addressLine2 ?? ""),
    city: String(config.city ?? ""),
    state: String(config.state ?? ""),
    postalCode: String(config.postalCode ?? ""),
    usageIndicator: config.usageIndicator === "P" ? "P" : "T",
    payerIds: stringMap(config.payerIds),
  };
}

export async function getBatchExportData(batchId: string): Promise<BatchOutputData> {
  const data = await getClaimSubmissionData();
  const batch = data.batches.find((row) => row.id === batchId);
  if (!batch) throw new Error("Claim batch not found.");

  const claimIds = batch.claimIds.filter(Boolean);
  const tenantId = await getCurrentTenantId();
  const tenantRows = await referenceSelect<DataRow>("tenants", {
    id: `eq.${tenantId}`,
    limit: "1",
  });
  const edi = read837PConfig(tenantRows[0]?.settings);

  if (!claimIds.length) return { batch, edi, claims: [] };

  const claimRows = claimIds.map((claimId) => {
    const claim = data.claims.find((row) => row.id === claimId);
    if (!claim) throw new Error(`Claim ${claimId} was not found in the batch.`);
    return claim;
  });

  const clientIds = [...new Set(claimRows.map((row) => String(row.client_id ?? "")).filter(Boolean))];
  const providerIds = [...new Set(claimRows.map((row) => String(row.rendering_provider_id ?? "")).filter(Boolean))];
  const payerIds = [...new Set(claimRows.map((row) => String(row.payer_id ?? "")).filter(Boolean))];

  const [lines, diagnoses, clients, providers, payers, policies] = await Promise.all([
    tenantSelect<DataRow>("professional_claim_lines", {
      claim_id: inFilter(claimIds),
      order: "service_date.asc,created_at.asc",
    }),
    tenantSelect<DataRow>("claim_diagnoses", {
      claim_id: inFilter(claimIds),
      order: "pointer_order.asc",
    }),
    clientIds.length
      ? tenantSelect<DataRow>("clients", { id: inFilter(clientIds) })
      : Promise.resolve([]),
    providerIds.length
      ? tenantSelect<DataRow>("providers", { id: inFilter(providerIds) })
      : Promise.resolve([]),
    payerIds.length
      ? referenceSelect<DataRow>("payers", { id: inFilter(payerIds) })
      : Promise.resolve([]),
    clientIds.length
      ? tenantSelect<DataRow>("client_insurance_policies", {
          client_id: inFilter(clientIds),
          order: "created_at.desc",
        })
      : Promise.resolve([]),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const claims: ClaimOutputItem[] = claimRows.map((claim) => {
    const clientId = String(claim.client_id ?? "");
    const payerId = String(claim.payer_id ?? "");
    const policy =
      policies.find(
        (row) =>
          String(row.client_id ?? "") === clientId &&
          String(row.payer_id ?? "") === payerId &&
          String(row.status ?? "") === "active" &&
          String(row.insurance_order ?? "") === "primary",
      ) ??
      policies.find(
        (row) =>
          String(row.client_id ?? "") === clientId &&
          String(row.payer_id ?? "") === payerId &&
          String(row.insurance_order ?? "") === "primary",
      ) ??
      policies.find(
        (row) =>
          String(row.client_id ?? "") === clientId &&
          String(row.payer_id ?? "") === payerId,
      ) ??
      null;

    return {
      claim,
      lines: lines.filter((row) => String(row.claim_id ?? "") === claim.id),
      diagnoses: diagnoses.filter((row) => String(row.claim_id ?? "") === claim.id),
      client: clientsById.get(clientId) ?? null,
      provider: providersById.get(String(claim.rendering_provider_id ?? "")) ?? null,
      payer: payersById.get(payerId) ?? null,
      policy,
    };
  });

  return { batch, edi, claims };
}
