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

export function resolveMailroomWorkContext(input: {
  mailroomItem: Row & { id: string };
  linkedClaim?: Row & { id: string };
  client?: Row & { id: string };
  provider?: Row & { id: string };
  payer?: Row & { id: string };
}) {
  const { mailroomItem, linkedClaim, client, provider, payer } = input;
  const clientId = String(mailroomItem.client_id ?? linkedClaim?.client_id ?? "");
  const providerId = String(mailroomItem.provider_id ?? "");
  const payerId = String(mailroomItem.payer_id ?? linkedClaim?.payer_id ?? "");
  const patientName = clientId ? personName(client) : "—";
  const providerName = providerId ? personName(provider) : "—";
  const payerName = payerId ? String(payer?.name ?? "—") : "—";
  const claimNumber = String(
    linkedClaim?.patient_control_number ?? linkedClaim?.payer_claim_number ?? "",
  );
  const relatedName = [
    String(mailroomItem.subject || "Correspondence"),
    patientName !== "—" ? patientName : "",
    claimNumber,
  ].filter(Boolean).join(" · ");

  return {
    clientId,
    providerId,
    payerId,
    patientName,
    providerName,
    payerName,
    relatedName,
  };
}

export function sourceRouteForWorkItem(type: string, id: string) {
  switch (type) {
    case "client": return `/clients/${id}`;
    case "claim": return `/claims/${id}`;
    case "encounter": return `/encounters/${id}`;
    case "appointment": return `/schedule/${id}`;
    case "provider": return `/providers/${id}`;
    case "authorization": return "/authorizations";
    case "eligibility": return "/eligibility";
    case "charge": return "/billing/charges";
    case "payment": return "/payments";
    case "denial": return "/ar-denials?tab=denials";
    case "appeal": return "/ar-denials";
    case "adjustment": return "/ar-denials?tab=recovery";
    case "era": return "/payments";
    case "claim_batch": return "/claims/submission";
    case "payer_contract": return "/payers-contracts";
    case "mailroom_item": return `/mailroom/${id}`;
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
    authorizations,
    eligibility,
    payments,
    denials,
    adjustments,
    batches,
    eraFiles,
    payerContracts,
    mailroomItems,
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
    tenantSelect<DataRow>("authorizations"),
    tenantSelect<DataRow>("eligibility_checks"),
    tenantSelect<DataRow>("payments"),
    tenantSelect<DataRow>("denials"),
    tenantSelect<DataRow>("adjustments"),
    tenantSelect<DataRow>("claim_batches"),
    tenantSelect<DataRow>("era_files"),
    tenantSelect<DataRow>("payer_contracts"),
    tenantSelect<DataRow>("mailroom_items"),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const claimsById = new Map(claims.map((row) => [row.id, row]));
  const encountersById = new Map(encounters.map((row) => [row.id, row]));
  const appointmentsById = new Map(appointments.map((row) => [row.id, row]));
  const chargesById = new Map(charges.map((row) => [row.id, row]));
  const authById = new Map(authorizations.map((row) => [row.id, row]));
  const eligibilityById = new Map(eligibility.map((row) => [row.id, row]));
  const paymentsById = new Map(payments.map((row) => [row.id, row]));
  const denialsById = new Map(denials.map((row) => [row.id, row]));
  const adjustmentsById = new Map(adjustments.map((row) => [row.id, row]));
  const batchesById = new Map(batches.map((row) => [row.id, row]));
  const eraById = new Map(eraFiles.map((row) => [row.id, row]));
  const contractsById = new Map(payerContracts.map((row) => [row.id, row]));
  const mailroomById = new Map(mailroomItems.map((row) => [row.id, row]));

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
    } else if (type === "authorization") {
      const row = authById.get(id);
      clientId = String(row?.client_id ?? "");
      payerId = String(row?.payer_id ?? "");
      relatedName = `Authorization · ${personName(clientsById.get(clientId))}`;
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
    } else if (type === "era") {
      const row = eraById.get(id);
      payerId = String(row?.payer_id ?? "");
      relatedName = String(row?.file_name || "ERA / 835");
    } else if (type === "payer_contract") {
      const row = contractsById.get(id);
      payerId = String(row?.payer_id ?? "");
      relatedName = `Payer Contract · ${String(payersById.get(payerId)?.name || "Payer")}`;
    } else if (type === "mailroom_item") {
      const row = mailroomById.get(id);
      const claim = claimsById.get(String(row?.claim_id ?? ""));
      const resolvedClientId = String(row?.client_id ?? claim?.client_id ?? "");
      const resolvedProviderId = String(row?.provider_id ?? "");
      const resolvedPayerId = String(row?.payer_id ?? claim?.payer_id ?? "");
      return resolveMailroomWorkContext({
        mailroomItem: row ?? { id, subject: "Correspondence" },
        linkedClaim: claim,
        client: clientsById.get(resolvedClientId),
        provider: providersById.get(resolvedProviderId),
        payer: payersById.get(resolvedPayerId),
      });
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
      history: historyByItem.get(item.id) ?? [],
    };
  });
}
