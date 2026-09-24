import type { Edi837PConfig } from "./claim-output";

/**
 * Shared Colorado payer defaults. Only IDs published in the payer reference
 * catalog are used; clearinghouse-specific IDs are never inferred from names.
 * Existing tenant overrides remain authoritative for their selected partner.
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

/** Apply current shared reference data on each read; no per-practice setup or save required. */
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
  return {
    ...config,
    payerIds,
    claimFilingIndicators,
    // ERA identifiers are payer/trading-partner-specific. Never copy an
    // outbound 837P identifier into the inbound remittance mapping.
    eraPayerIdentifiers: { ...config.eraPayerIdentifiers },
  };
}
