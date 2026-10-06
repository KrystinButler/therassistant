import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import {
  changePriority,
  completeWork,
  pendWork,
  reopenWork,
  startWork,
  type WorkCenterRepository,
} from "./workflow";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

const repository: WorkCenterRepository = {
  async getWorkItem(id) {
    return first(
      await tenantSelect<DataRow>("workqueue_items", {
        id: `eq.${id}`,
        limit: "1",
      }),
    );
  },
  updateWorkItem(id, values) {
    return tenantUpdate<DataRow>("workqueue_items", id, values);
  },
  insertHistory(values) {
    return tenantInsert<DataRow>("workqueue_history", values);
  },
};

export function startWorkItem(id: string, note?: string) {
  return startWork(repository, id, note);
}

export function pendWorkItem(id: string, note: string, snooze = false) {
  return pendWork(repository, id, note, snooze ? "snoozed" : "pending");
}

export function changeWorkPriority(
  id: string,
  priority: "low" | "normal" | "high" | "urgent",
) {
  return changePriority(repository, id, priority);
}

export function completeWorkItem(id: string, note: string) {
  return completeWork(repository, id, note);
}

export function reopenWorkItem(id: string, note: string) {
  return reopenWork(repository, id, note);
}

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

export function sourceRouteForWorkItem(type: string, id: string) {
  const safeId = encodeURIComponent(id);
  switch (type) {
    case "client": return `/clients/${safeId}`;
    case "claim": return `/claims/${safeId}`;
    case "encounter": return `/encounters/${safeId}`;
    case "appointment": return `/schedule/${safeId}`;
    case "provider": return `/providers/${safeId}`;
    case "eligibility": return "/eligibility";
    case "charge": return "/billing/charges?tab=unbatched";
    case "payment": return `/payments?payment=${safeId}`;
    case "denial": return `/denials?denial=${safeId}`;
    case "appeal": return `/denials?tab=appeals&appeal=${safeId}`;
    case "adjustment": return "/payments?tab=recovery";
    case "era":
    case "era_claim": return "/payments?tab=era";
    case "claim_batch": return "/billing/charges?tab=batches";
    case "payer_contract": return "/payers-contracts";
    case "credentialing_application":
    case "provider_credential":
    case "network_participation":
    case "roster_action":
    case "credentialing_issue":
    case "provider_enrollment":
    case "provider_payer_enrollment":
    case "provider_network_participation":
      return "/credentialing";
    case "historical_transaction":
    case "ledger_entry":
      return "/payments";
    default: return "/work-center";
  }
}

/**
 * Work Center starts work in the operational queue that owns the exception.
 * The source-record link remains separate so staff can still inspect the
 * encounter, claim, or patient without losing the exact correction context.
 */
export function workRouteForWorkItem(
  type: string,
  id: string,
  workqueueType: string,
  related: { encounterId?: string; claimId?: string; clientId?: string; workItemId?: string } = {},
) {
  const queue = workqueueType.trim().toLowerCase();
  const encounterId = type === "encounter" ? id : related.encounterId;
  const claimId = type === "claim" ? id : related.claimId;
  const queryId = (value: string) => encodeURIComponent(value);

  if (queue.startsWith("billing_readiness") || queue === "charge_validation") {
    return `/billing/charges?tab=blocked${encounterId ? `&focus=${queryId(encounterId)}` : ""}`;
  }
  if (queue === "eligibility_issue") {
    return related.clientId ? `/clients/${queryId(related.clientId)}?tab=coverage` : "/eligibility";
  }
  if (queue === "credentialing_issue" && type === "encounter") {
    return "/payers-contracts";
  }
  if (queue === "missing_documentation" && encounterId) {
    return `/encounters/${queryId(encounterId)}#encounter-progress-note-editor`;
  }
  if (queue === "charge_capture" || queue === "charges_ready") {
    return `/billing/charges?tab=ready${encounterId ? `&focus=${queryId(encounterId)}` : ""}`;
  }
  if (["claim_validation", "claim_rejection", "claim_correction"].includes(queue)) {
    return `/rejections${claimId ? `?claim=${queryId(claimId)}` : ""}`;
  }
  if (["claim_followup", "claim_follow_up", "insurance_ar", "payer_followup"].includes(queue)) {
    return `/claims${claimId ? `?claim=${queryId(claimId)}` : ""}`;
  }
  if (queue === "claim_submission" || queue === "claim_batch") {
    return "/billing/charges?tab=unbatched";
  }
  if (queue === "denial_followup" || queue === "denial_follow_up") {
    return type === "denial"
      ? `/denials?denial=${queryId(id)}`
      : `/denials${claimId ? `?claim=${queryId(claimId)}` : ""}`;
  }
  if (queue === "appeal_deadline" || queue === "appeal_followup") {
    return type === "appeal"
      ? `/denials?tab=appeals&appeal=${queryId(id)}`
      : "/denials?tab=appeals";
  }
  if (["underpayment", "payment_variance", "contract_variance"].includes(queue)) {
    return "/payments?tab=underpayments";
  }
  if (["recoupment", "refund", "recovery"].includes(queue)) {
    return "/payments?tab=recovery";
  }
  if (["payment_exception", "unapplied_payment", "payment_posting_issue"].includes(queue)) {
    if (["era", "era_claim"].includes(type) || (queue === "payment_posting_issue" && type !== "payment")) return `/payments?tab=era${related.workItemId ? `&work=${queryId(related.workItemId)}` : ""}`;
    return type === "payment"
      ? `/payments?payment=${queryId(id)}`
      : "/payments?tab=unapplied";
  }
  if (["era_match_exception", "era_import", "unmatched_era"].includes(queue)) {
    return `/payments?tab=era${related.workItemId ? `&work=${queryId(related.workItemId)}` : ""}`;
  }
  if (["documentation", "clinical_documentation", "unsigned_note"].includes(queue) && encounterId) {
    return `/encounters/${queryId(encounterId)}#encounter-progress-note-editor`;
  }
  if (queue === "signature" && encounterId) {
    return `/encounters/${queryId(encounterId)}#encounter-signature`;
  }
  return sourceRouteForWorkItem(type, id);
}

export async function getWorkCenterData() {
  const [
    workItems,
    history,
    clients,
    providers,
    payers,
    claims,
    encounters,
    appointments,
    charges,
    eligibility,
    payments,
    denials,
    adjustments,
    batches,
    eraFiles,
    eraClaims,
    payerContracts,
  ] = await Promise.all([
    tenantSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
    tenantSelect<DataRow>("workqueue_history", { order: "created_at.desc" }),
    tenantSelect<DataRow>("clients"),
    tenantSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("professional_claims"),
    tenantSelect<DataRow>("encounters"),
    tenantSelect<DataRow>("appointments"),
    tenantSelect<DataRow>("charge_capture_items"),
    tenantSelect<DataRow>("eligibility_checks"),
    tenantSelect<DataRow>("payments"),
    tenantSelect<DataRow>("denials"),
    tenantSelect<DataRow>("adjustments"),
    tenantSelect<DataRow>("claim_batches"),
    tenantSelect<DataRow>("era_files"),
    tenantSelect<DataRow>("era_claims"),
    tenantSelect<DataRow>("payer_contracts"),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const encountersById = new Map(encounters.map((row) => [row.id, row]));
  const appointmentsById = new Map(appointments.map((row) => [row.id, row]));
  const chargesById = new Map(charges.map((row) => [row.id, row]));
  const eligibilityById = new Map(eligibility.map((row) => [row.id, row]));
  const paymentsById = new Map(payments.map((row) => [row.id, row]));
  const denialsById = new Map(denials.map((row) => [row.id, row]));
  const adjustmentsById = new Map(adjustments.map((row) => [row.id, row]));
  const batchesById = new Map(batches.map((row) => [row.id, row]));
  const eraClaimsById = new Map(eraClaims.map((row) => [row.id, row]));
  const eraById = new Map(eraFiles.map((row) => [row.id, row]));
  const contractsById = new Map(payerContracts.map((row) => [row.id, row]));

  const historyByItem = new Map<string, DataRow[]>();
  for (const row of history) {
    const id = String(row.workqueue_item_id ?? "");
    const list = historyByItem.get(id) ?? [];
    list.push(row);
    historyByItem.set(id, list);
  }

  function resolveContext(type: string, id: string) {
    let clientId = "";
    let providerId = "";
    let payerId = "";
    let relatedName = "—";

    if (type === "client") {
      clientId = id;
      relatedName = personName(clientsById.get(id));
    } else if (type === "claim") {
      const row = claimsById.get(id);
      clientId = String(row?.client_id ?? "");
      providerId = String(row?.rendering_provider_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `${String(row?.patient_control_number || "Claim")} · ${personName(clientsById.get(clientId))}`;
    } else if (type === "encounter") {
      const row = encountersById.get(id);
      clientId = String(row?.client_id ?? "");
      providerId = String(row?.provider_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `Encounter · ${personName(clientsById.get(clientId))}`;
    } else if (type === "appointment") {
      const row = appointmentsById.get(id);
      clientId = String(row?.client_id ?? "");
      providerId = String(row?.provider_id ?? "");
      relatedName = `Appointment · ${personName(clientsById.get(clientId))}`;
    } else if (type === "charge") {
      const row = chargesById.get(id);
      clientId = String(row?.client_id ?? "");
      providerId = String(row?.provider_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `${String(row?.cpt_code || "Charge")} · ${personName(clientsById.get(clientId))}`;
    } else if (type === "eligibility") {
      const row = eligibilityById.get(id);
      clientId = String(row?.client_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `Eligibility · ${personName(clientsById.get(clientId))}`;
    } else if (type === "payment") {
      const row = paymentsById.get(id);
      clientId = String(row?.client_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `${String(row?.trace_number || "Payment")} · ${personName(clientsById.get(clientId))}`;
    } else if (type === "denial") {
      const row = denialsById.get(id);
      clientId = String(row?.client_id ?? "");
      payerId = String(row?.payer_id ?? "");
      const claim = claimsById.get(String(row?.claim_id ?? ""));
      relatedName = `${String(claim?.patient_control_number || "Denial")} · ${personName(clientsById.get(clientId))}`;
    } else if (type === "adjustment") {
      const row = adjustmentsById.get(id);
      const claim = claimsById.get(String(row?.claim_id ?? ""));
      clientId = String(row?.client_id ?? claim?.client_id ?? "");
      providerId = String(claim?.rendering_provider_id ?? "");
      payerId = String(row?.payer_id ?? claim?.payer_id ?? "");
      relatedName = `${String(row?.adjustment_type || "Recovery").replaceAll("_", " ")} · ${String(claim?.patient_control_number || "Claim")} · ${personName(clientsById.get(clientId))}`;
    } else if (type === "provider") {
      providerId = id;
      relatedName = personName(providersById.get(id));
    } else if (type === "claim_batch") {
      relatedName = String(batchesById.get(id)?.batch_name || "Claim Batch");
    } else if (type === "era_claim") {
      const row = eraClaimsById.get(id);
      const claim = claimsById.get(String(row?.claim_id ?? ""));
      const file = eraById.get(String(row?.era_file_id ?? ""));
      clientId = String(row?.client_id ?? claim?.client_id ?? "");
      providerId = String(claim?.rendering_provider_id ?? "");
      payerId = String(file?.payer_id ?? claim?.payer_id ?? "");
      relatedName = `${String(row?.patient_control_number || "ERA claim")} · ${String(file?.file_name || "ERA / 835")}`;
    } else if (type === "era") {
      const row = eraById.get(id);
      payerId = String(row?.payer_id ?? "");
      relatedName = String(row?.file_name || "ERA / 835");
    } else if (type === "payer_contract") {
      const row = contractsById.get(id);
      payerId = String(row?.payer_id ?? "");
      relatedName = `Payer Contract · ${String(payersById.get(payerId)?.name || "Payer")}`;
    } else if (type === "legacy_correspondence") {
      relatedName = "Legacy correspondence task";

    }

    return {
      clientId,
      providerId,
      payerId,
      patientName: clientId ? personName(clientsById.get(clientId)) : "—",
      providerName: providerId ? personName(providersById.get(providerId)) : "—",
      payerName: payerId ? String(payersById.get(payerId)?.name ?? "—") : "—",
      relatedName,
    };
  }

  return workItems.map((item) => {
    const sourceType = String(item.source_object_type ?? "");
    const sourceId = String(item.source_object_id ?? "");
    const context = resolveContext(sourceType, sourceId);
    return {
      ...item,
      ...context,
      sourceRoute: sourceRouteForWorkItem(sourceType, sourceId),
      workRoute: workRouteForWorkItem(sourceType, sourceId, String(item.workqueue_type ?? ""), {
        clientId: context.clientId,
        workItemId: item.id,
        encounterId: sourceType === "charge"
          ? String(chargesById.get(sourceId)?.encounter_id ?? "")
          : undefined,
        claimId: sourceType === "denial"
          ? String(denialsById.get(sourceId)?.claim_id ?? "")
          : sourceType === "adjustment"
            ? String(adjustmentsById.get(sourceId)?.claim_id ?? "")
            : undefined,
      }),
      history: historyByItem.get(item.id) ?? [],
    };
  });
}
