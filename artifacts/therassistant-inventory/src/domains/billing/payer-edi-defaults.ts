import type { Edi837PConfig } from "./claim-output";

/**
 * Shared Colorado payer defaults. Only IDs published in the payer reference
 * catalog are used; clearinghouse-specific IDs are never inferred from names.
 * Payer-specific overrides remain authoritative, while Office Ally is the
 * platform-managed clearinghouse for every practice.
 */
export type PayerEdiReference = {
  id: string;
  name?: unknown;
  normalized_name?: unknown;
  payer_type?: unknown;
  clearinghouse_payer_id?: unknown;
};

export function defaultClaimFilingIndicator(payer: PayerEdiReference): string {
  const name = String(payer.normalized_name || payer.name || "").trim().toLowerCase();
  const type = String(payer.payer_type || "").trim().toLowerCase();
  if (type === "medicaid_rae" || ["health first colorado", "medicaid"].includes(name)) return "MC";
  if (name === "medicare") return "MB";
  if (name === "tricare") return "CH";
  if (name.includes("blue cross blue shield") || name.includes("bluecross blueshield")) return "BL";
  if (type === "commercial") return "CI";
  return "";
}

function taxId(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 15);
}

/** Apply Office Ally and shared payer reference defaults on every read; no practice clearinghouse setup required. */
export function resolvePayerEdiConfig(
  config: Edi837PConfig,
  payers: PayerEdiReference[],
): Edi837PConfig {
  const payerIds = { ...config.payerIds };
  const claimFilingIndicators = { ...config.claimFilingIndicators };
  for (const payer of payers) {
    if (!payer?.id) continue;
    const catalogId = String(payer.clearinghouse_payer_id ?? "").trim();
    if (!String(payerIds[payer.id] ?? "").trim() && catalogId) {
      payerIds[payer.id] = catalogId;
    }
    const defaultIndicator = defaultClaimFilingIndicator(payer);
    if (!String(claimFilingIndicators[payer.id] ?? "").trim() && defaultIndicator) {
      claimFilingIndicators[payer.id] = defaultIndicator;
    }
  }

  const billingName = String(config.billingProviderName ?? "").trim();
  const senderId = taxId(config.billingProviderTaxId);

  return {
    ...config,
    // Office Ally's 837P guide publishes receiver ID 330897513 and permits a
    // submitter-chosen sender ID; the billing TIN is the standard automatic
    // choice, so practices never configure a clearinghouse profile in the EHR.
    submitterName: String(config.submitterName ?? "").trim() || billingName,
    submitterId: String(config.submitterId ?? "").trim() || senderId,
    receiverName: "OFFICE ALLY",
    receiverId: "330897513",
    contactName: String(config.contactName ?? "").trim() || billingName,
    usageIndicator: "P",
    payerIds,
    claimFilingIndicators,
    // ERA identifiers are payer/trading-partner-specific. Never copy an
    // outbound 837P identifier into the inbound remittance mapping.
    eraPayerIdentifiers: { ...config.eraPayerIdentifiers },
  };
}
