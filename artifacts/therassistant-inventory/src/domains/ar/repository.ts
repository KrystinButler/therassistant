import { demoSelect, referenceSelect, type Row } from "../../lib/supabase-demo-client";
import { agingBucket, calculateOpenBalance, daysOutstanding, type AgingBucket } from "./aging";

type DataRow = Row & { id: string };
export type ArRow = DataRow & {
  clientName: string;
  providerName: string;
  payerName: string;
  paidAmountCents: number;
  adjustmentAmountCents: number;
  openBalanceCents: number;
  daysOutstanding: number;
  bucket: AgingBucket;
  denialStatus: string;
  workStatus: string;
};

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function total(rows: DataRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export async function getArWorkspaceData(asOfDate = new Date().toISOString().slice(0, 10)) {
  const [claims, clients, providers, payers, allocations, adjustments, denials, appeals, workItems] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "service_date_from.asc" }),
    demoSelect<DataRow>("clients"),
    demoSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("payment_allocations", { order: "created_at.desc" }),
    demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    demoSelect<DataRow>("denials", { order: "created_at.desc" }),
    demoSelect<DataRow>("appeals", { order: "created_at.desc" }),
    demoSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const rows = claims.flatMap((claim): ArRow[] => {
    const claimId = claim.id;
    const paidAmountCents = total(allocations.filter((row) => row.claim_id === claimId && !row.reversed_at), "amount_cents");
    const claimAdjustments = adjustments.filter((row) => row.claim_id === claimId && !["reversed", "voided"].includes(String(row.adjustment_status ?? "")));
    const adjustmentAmountCents = total(claimAdjustments, "amount_cents");
    const openBalanceCents = calculateOpenBalance(Number(claim.total_charge_cents ?? 0), paidAmountCents, adjustmentAmountCents);
    if (openBalanceCents <= 0 || ["voided", "reversed"].includes(String(claim.claim_status ?? ""))) return [];
    const serviceDate = String(claim.service_date_from ?? claim.created_at ?? asOfDate).slice(0, 10);
    const denial = denials.find((row) => row.claim_id === claimId);
    const work = workItems.find((row) => row.source_object_type === "claim" && row.source_object_id === claimId && row.workqueue_status !== "completed");
    return [{
      ...claim,
      clientName: personName(clientsById.get(String(claim.client_id))),
      providerName: personName(providersById.get(String(claim.rendering_provider_id))),
      payerName: String(payersById.get(String(claim.payer_id))?.name ?? "—"),
      paidAmountCents,
      adjustmentAmountCents,
      openBalanceCents,
      daysOutstanding: daysOutstanding(serviceDate, asOfDate),
      bucket: agingBucket(serviceDate, asOfDate),
      denialStatus: String(denial?.denial_status ?? "—"),
      workStatus: String(work?.workqueue_status ?? "—"),
    }];
  });

  return {
    insuranceAr: rows.filter((row) => row.claim_status !== "patient_responsibility"),
    patientAr: rows.filter((row) => row.claim_status === "patient_responsibility"),
    denials,
    appeals,
    adjustments,
    workItems,
    payers,
    providers,
  };
}
