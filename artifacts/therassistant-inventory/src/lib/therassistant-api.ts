import { useEffect, useState } from "react";

import { authenticatedFetch, SUPABASE_URL } from "./supabase-client";
import { requireActiveTenantId } from "./tenant-session";

const nativeFetch = globalThis.fetch.bind(globalThis);

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type Row = Record<string, any>;

function camelKey(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function hybrid<T extends Row>(row: T): T {
  const next: Row = { ...row };

  for (const [key, value] of Object.entries(row)) {
    const camel = camelKey(key);
    if (!(camel in next)) {
      next[camel] = value;
    }
  }

  return next as T;
}

function hybridRows(rows: Row[]) {
  return rows.map((row) => hybrid(row));
}

function fullName(row?: Row | null) {
  if (!row) return null;
  return [row.first_name, row.last_name]
    .filter(Boolean)
    .join(" ") || null;
}

function byId(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function sortNewest(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const aValue = Date.parse(
      a.created_at ?? a.updated_at ?? a.service_date ?? "",
    );
    const bValue = Date.parse(
      b.created_at ?? b.updated_at ?? b.service_date ?? "",
    );
    return (Number.isNaN(bValue) ? 0 : bValue) -
      (Number.isNaN(aValue) ? 0 : aValue);
  });
}

async function supabaseRows(
  table: string,
  filters: Record<string, string> = {},
): Promise<Row[]> {
  const url = new URL(
    `${SUPABASE_URL}/rest/v1/${table}`,
  );
  url.searchParams.set("select", "*");

  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await authenticatedFetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Supabase ${table} request failed (${response.status})${
        text ? `: ${text}` : ""
      }`,
    );
  }

  const data = (await response.json()) as Row[];
  return hybridRows(data);
}

async function tenantRows(table: string) {
  const tenantId = requireActiveTenantId();
  return supabaseRows(table, { tenant_id: `eq.${tenantId}` });
}

async function referenceRows(table: string) {
  return supabaseRows(table);
}

async function claimRows() {
  const [
    claims,
    clients,
    providers,
    payers,
    balances,
    denials,
  ] = await Promise.all([
    tenantRows("professional_claims"),
    tenantRows("clients"),
    tenantRows("providers"),
    referenceRows("payers"),
    tenantRows("claim_balance_summaries"),
    tenantRows("denials"),
  ]);

  const clientMap = byId(clients);
  const providerMap = byId(providers);
  const payerMap = byId(payers);
  const balanceMap = new Map(
    balances.map((row) => [row.claim_id, row]),
  );

  return claims.map((claim) => {
    const balance = balanceMap.get(claim.id);
    const rendering = providerMap.get(
      claim.rendering_provider_id,
    );
    const billing = providerMap.get(
      claim.billing_provider_id,
    );

    return {
      ...claim,
      clientName: fullName(clientMap.get(claim.client_id)),
      payerName: payerMap.get(claim.payer_id)?.name ?? null,
      renderingProviderName: fullName(rendering),
      renderingProviderCredentials:
        rendering?.credentials ?? null,
      billingProviderName: fullName(billing),
      billingProviderCredentials:
        billing?.credentials ?? null,
      paidAmountCents:
        balance?.paid_amount_cents ?? 0,
      adjustmentAmountCents:
        balance?.adjustment_amount_cents ?? 0,
      openBalanceCents:
        balance?.open_balance_cents ??
        claim.total_charge_cents ??
        0,
      denialCount: denials.filter(
        (denial) => denial.claim_id === claim.id,
      ).length,
    };
  });
}

async function clientRows(search = "") {
  const [
    clients,
    policies,
    payers,
    plans,
    appointments,
    balances,
  ] = await Promise.all([
    tenantRows("clients"),
    tenantRows("client_insurance_policies"),
    referenceRows("payers"),
    referenceRows("payer_plans"),
    tenantRows("appointments"),
    tenantRows("client_balance_summaries"),
  ]);

  const payerMap = byId(payers);
  const planMap = byId(plans);
  const balanceMap = new Map(
    balances.map((row) => [row.client_id, row]),
  );
  const normalized = search.trim().toLowerCase();
  const now = Date.now();

  return clients
    .filter((client) => {
      if (!normalized) return true;
      return [
        client.first_name,
        client.last_name,
        client.preferred_name,
        client.email,
        client.phone,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalized),
        );
    })
    .map((client) => {
      const policy = policies.find(
        (item) =>
          item.client_id === client.id &&
          item.insurance_order === "primary",
      ) ?? policies.find((item) => item.client_id === client.id);

      const futureAppointments = appointments
        .filter(
          (appointment) =>
            appointment.client_id === client.id &&
            Date.parse(appointment.starts_at) >= now,
        )
        .sort(
          (a, b) =>
            Date.parse(a.starts_at) - Date.parse(b.starts_at),
        );

      return {
        ...client,
        firstName: client.first_name,
        lastName: client.last_name,
        preferredName: client.preferred_name,
        dateOfBirth: client.date_of_birth,
        clientStatus: client.client_status,
        registrationStatus: client.registration_status,
        billingReadinessStatus:
          client.billing_readiness_status,
        payerName:
          policy?.payer_id
            ? payerMap.get(policy.payer_id)?.name ?? null
            : null,
        planName:
          policy?.payer_plan_id
            ? planMap.get(policy.payer_plan_id)?.name ?? null
            : null,
        nextAppointment:
          futureAppointments[0]?.starts_at ?? null,
        openBalanceCents:
          balanceMap.get(client.id)?.open_balance_cents ?? 0,
      };
    });
}

async function providerRows() {
  const [providers, claims, workItems] = await Promise.all([
    tenantRows("providers"),
    tenantRows("professional_claims"),
    tenantRows("workqueue_items"),
  ]);

  return providers.map((provider) => {
    const providerClaims = claims.filter(
      (claim) =>
        claim.rendering_provider_id === provider.id ||
        claim.billing_provider_id === provider.id,
    );
    const claimIds = new Set(
      providerClaims.map((claim) => claim.id),
    );
    const openIssues = workItems.filter(
      (item) =>
        !["completed", "cancelled"].includes(
          item.workqueue_status,
        ) &&
        ((item.source_object_type === "provider" &&
          item.source_object_id === provider.id) ||
          (item.source_object_type === "claim" &&
            claimIds.has(item.source_object_id))),
    );

    return {
      ...provider,
      firstName: provider.first_name,
      lastName: provider.last_name,
      providerStatus: provider.provider_status,
      individualNpi: provider.individual_npi,
      taxonomyCode: provider.taxonomy_code,
      claimCount: providerClaims.length,
      openIssueCount: openIssues.length,
    };
  });
}

async function workqueueRows() {
  const [items, clients, providers, claims, payers] =
    await Promise.all([
      tenantRows("workqueue_items"),
      tenantRows("clients"),
      tenantRows("providers"),
      claimRows(),
      referenceRows("payers"),
    ]);

  const clientMap = byId(clients);
  const providerMap = byId(providers);
  const claimMap = byId(claims);
  const payerMap = byId(payers);

  return sortNewest(items).map((item) => {
    let relatedName: string | null = null;
    let payerName: string | null = null;

    if (item.source_object_type === "client") {
      relatedName = fullName(clientMap.get(item.source_object_id));
    } else if (item.source_object_type === "provider") {
      relatedName = fullName(providerMap.get(item.source_object_id));
    } else if (item.source_object_type === "claim") {
      const claim = claimMap.get(item.source_object_id);
      relatedName = claim?.clientName ?? null;
      payerName = claim?.payerName ?? null;
    }

    if (!payerName && item.payer_id) {
      payerName = payerMap.get(item.payer_id)?.name ?? null;
    }

    return {
      ...item,
      workqueueType: item.workqueue_type,
      workqueueStatus: item.workqueue_status,
      sourceObjectType: item.source_object_type,
      sourceObjectId: item.source_object_id,
      dueDate: item.due_date,
      relatedName,
      payerName,
    };
  });
}

async function dashboardData() {
  const [clients, providers, claims, workItems] =
    await Promise.all([
      clientRows(),
      providerRows(),
      claimRows(),
      workqueueRows(),
    ]);

  const openClaims = claims.filter(
    (claim) =>
      !["paid", "voided", "reversed"].includes(
        claim.claim_status,
      ),
  );

  return {
    totalClients: clients.length,
    activeProviders: providers.filter(
      (provider) => provider.provider_status === "active",
    ).length,
    openClaims: openClaims.length,
    deniedClaims: claims.filter(
      (claim) => claim.claim_status === "denied",
    ).length,
    openWorkItems: workItems.filter(
      (item) =>
        !["completed", "cancelled"].includes(
          item.workqueue_status,
        ),
    ).length,
    totalOpenBalanceCents: openClaims.reduce(
      (sum, claim) =>
        sum + Number(claim.openBalanceCents ?? 0),
      0,
    ),
    recentWorkItems: workItems.slice(0, 5),
    recentClaims: sortNewest(claims).slice(0, 5),
  };
}

async function clientDetail(id: string) {
  const [
    clients,
    policies,
    payers,
    plans,
    appointments,
    providers,
    treatmentPlans,
    clinicalNotes,
    signatures,
    charges,
    claims,
    payments,
    denials,
    workItems,
  ] = await Promise.all([
    tenantRows("clients"),
    tenantRows("client_insurance_policies"),
    referenceRows("payers"),
    referenceRows("payer_plans"),
    tenantRows("appointments"),
    tenantRows("providers"),
    tenantRows("treatment_plans"),
    tenantRows("clinical_notes"),
    tenantRows("clinical_note_signatures"),
    tenantRows("charge_capture_items"),
    claimRows(),
    tenantRows("payments"),
    tenantRows("denials"),
    tenantRows("workqueue_items"),
  ]);

  const client = clients.find((row) => row.id === id);
  if (!client) throw new Error("Client not found.");

  const payerMap = byId(payers);
  const planMap = byId(plans);
  const providerMap = byId(providers);
  const clientClaims = claims.filter(
    (claim) => claim.client_id === id,
  );
  const claimIds = new Set(clientClaims.map((claim) => claim.id));

  return {
    client,
    insurancePolicies: policies
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        payerName: payerMap.get(row.payer_id)?.name ?? null,
        planName: planMap.get(row.payer_plan_id)?.name ?? null,
      })),
    appointments: appointments
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        providerName: fullName(providerMap.get(row.provider_id)),
      })),
    treatmentPlans: treatmentPlans
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        providerName: fullName(providerMap.get(row.provider_id)),
      })),
    clinicalNotes: clinicalNotes
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        providerName: fullName(providerMap.get(row.provider_id)),
        signedAt:
          signatures.find(
            (signature) =>
              signature.clinical_note_id === row.id,
          )?.signed_at ?? null,
      })),
    charges: charges
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        providerName: fullName(providerMap.get(row.provider_id)),
        payerName: payerMap.get(row.payer_id)?.name ?? null,
      })),
    claims: clientClaims,
    payments: payments
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        payerName: payerMap.get(row.payer_id)?.name ?? null,
      })),
    denials: denials
      .filter((row) => row.client_id === id)
      .map((row) => ({
        ...row,
        payerName: payerMap.get(row.payer_id)?.name ?? null,
      })),
    workItems: workItems.filter(
      (row) =>
        row.source_object_id === id ||
        claimIds.has(row.source_object_id),
    ),
  };
}

async function providerDetail(id: string) {
  const [
    providers,
    appointments,
    clients,
    notes,
    charges,
    claims,
    payers,
    workItems,
  ] = await Promise.all([
    tenantRows("providers"),
    tenantRows("appointments"),
    tenantRows("clients"),
    tenantRows("clinical_notes"),
    tenantRows("charge_capture_items"),
    claimRows(),
    referenceRows("payers"),
    tenantRows("workqueue_items"),
  ]);

  const provider = providers.find((row) => row.id === id);
  if (!provider) throw new Error("Provider not found.");

  const clientMap = byId(clients);
  const payerMap = byId(payers);
  const renderingClaims = claims.filter(
    (claim) => claim.rendering_provider_id === id,
  );
  const billingClaims = claims.filter(
    (claim) => claim.billing_provider_id === id,
  );
  const claimIds = new Set(
    [...renderingClaims, ...billingClaims].map((claim) => claim.id),
  );

  return {
    provider,
    appointments: appointments
      .filter((row) => row.provider_id === id)
      .map((row) => ({
        ...row,
        clientName: fullName(clientMap.get(row.client_id)),
      })),
    clinicalNotes: notes
      .filter((row) => row.provider_id === id)
      .map((row) => ({
        ...row,
        clientName: fullName(clientMap.get(row.client_id)),
      })),
    charges: charges
      .filter((row) => row.provider_id === id)
      .map((row) => ({
        ...row,
        clientName: fullName(clientMap.get(row.client_id)),
        payerName: payerMap.get(row.payer_id)?.name ?? null,
      })),
    renderingClaims,
    billingClaims,
    workItems: workItems.filter(
      (row) =>
        (row.source_object_type === "provider" &&
          row.source_object_id === id) ||
        (row.source_object_type === "claim" &&
          claimIds.has(row.source_object_id)),
    ),
  };
}

async function claimDetail(id: string) {
  const [
    claims,
    charges,
    lines,
    diagnoses,
    statusHistory,
    notes,
    allocations,
    payments,
    balances,
    denials,
    appeals,
    workItems,
  ] = await Promise.all([
    claimRows(),
    tenantRows("charge_capture_items"),
    tenantRows("professional_claim_lines"),
    tenantRows("claim_diagnoses"),
    tenantRows("claim_status_history"),
    tenantRows("claim_notes"),
    tenantRows("payment_allocations"),
    tenantRows("payments"),
    tenantRows("claim_balance_summaries"),
    tenantRows("denials"),
    tenantRows("appeals"),
    tenantRows("workqueue_items"),
  ]);

  const claim = claims.find((row) => row.id === id);
  if (!claim) throw new Error("Claim not found.");

  const paymentMap = byId(payments);
  const claimAllocations = allocations.filter(
    (row) => row.claim_id === id,
  );

  return {
    claim,
    charge:
      charges.find((row) => row.id === claim.charge_id) ?? null,
    lines: lines.filter((row) => row.claim_id === id),
    diagnoses: diagnoses.filter((row) => row.claim_id === id),
    statusHistory: statusHistory.filter(
      (row) => row.claim_id === id,
    ),
    notes: notes.filter((row) => row.claim_id === id),
    payments: claimAllocations.map((allocation) => ({
      ...paymentMap.get(allocation.payment_id),
      allocationId: allocation.id,
      allocatedAmountCents: allocation.amount_cents,
    })),
    balance:
      balances.find((row) => row.claim_id === id) ?? null,
    denials: denials.filter((row) => row.claim_id === id),
    appeals: appeals.filter((row) => row.claim_id === id),
    workItems: workItems.filter(
      (row) =>
        row.source_object_type === "claim" &&
        row.source_object_id === id,
    ),
  };
}

async function scheduleRows() {
  const [appointments, clients, providers] = await Promise.all([
    tenantRows("appointments"),
    tenantRows("clients"),
    tenantRows("providers"),
  ]);
  const clientMap = byId(clients);
  const providerMap = byId(providers);

  return [...appointments]
    .sort(
      (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
    )
    .map((row) => ({
      ...row,
      clientName: fullName(clientMap.get(row.client_id)),
      providerName: fullName(providerMap.get(row.provider_id)),
    }));
}

async function eligibilityRows() {
  const [checks, clients, payers] = await Promise.all([
    tenantRows("eligibility_checks"),
    tenantRows("clients"),
    referenceRows("payers"),
  ]);
  const clientMap = byId(clients);
  const payerMap = byId(payers);

  return checks.map((row) => ({
    ...row,
    clientName: fullName(clientMap.get(row.client_id)),
    payerName: payerMap.get(row.payer_id)?.name ?? null,
  }));
}

async function authorizationData() {
  const [authorizations, units, clients, payers] =
    await Promise.all([
      tenantRows("authorizations"),
      tenantRows("authorization_units"),
      tenantRows("clients"),
      referenceRows("payers"),
    ]);
  const clientMap = byId(clients);
  const payerMap = byId(payers);

  return {
    authorizations: authorizations.map((row) => ({
      ...row,
      clientName: fullName(clientMap.get(row.client_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    authorizationUnits: units,
  };
}

async function chargeRows() {
  const [charges, clients, providers, payers] = await Promise.all([
    tenantRows("charge_capture_items"),
    tenantRows("clients"),
    tenantRows("providers"),
    referenceRows("payers"),
  ]);
  const clientMap = byId(clients);
  const providerMap = byId(providers);
  const payerMap = byId(payers);

  return charges.map((row) => ({
    ...row,
    clientName: fullName(clientMap.get(row.client_id)),
    providerName: fullName(providerMap.get(row.provider_id)),
    payerName: payerMap.get(row.payer_id)?.name ?? null,
  }));
}

async function credentialingData() {
  const [providers, enrollments, identifiers, payers] =
    await Promise.all([
      tenantRows("providers"),
      tenantRows("provider_payer_enrollments"),
      tenantRows("provider_identifiers"),
      referenceRows("payers"),
    ]);
  const providerMap = byId(providers);
  const payerMap = byId(payers);

  return {
    providers,
    enrollments: enrollments.map((row) => ({
      ...row,
      providerName: fullName(providerMap.get(row.provider_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    identifiers: identifiers.map((row) => ({
      ...row,
      providerName: fullName(providerMap.get(row.provider_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
  };
}

async function paymentsOverview() {
  const [payments, eras, adjustments, clients, payers] =
    await Promise.all([
      tenantRows("payments"),
      tenantRows("era_files"),
      tenantRows("adjustments"),
      tenantRows("clients"),
      referenceRows("payers"),
    ]);
  const clientMap = byId(clients);
  const payerMap = byId(payers);

  return {
    payments: payments.map((row) => ({
      ...row,
      clientName: fullName(clientMap.get(row.client_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    eraFiles: eras.map((row) => ({
      ...row,
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    adjustments: adjustments.map((row) => ({
      ...row,
      clientName: fullName(clientMap.get(row.client_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
  };
}

async function arDenialsData() {
  const [denials, appeals, balances, clients, payers] =
    await Promise.all([
      tenantRows("denials"),
      tenantRows("appeals"),
      tenantRows("claim_balance_summaries"),
      tenantRows("clients"),
      referenceRows("payers"),
    ]);
  const clientMap = byId(clients);
  const payerMap = byId(payers);

  return {
    denials: denials.map((row) => ({
      ...row,
      clientName: fullName(clientMap.get(row.client_id)),
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    appeals,
    claimBalances: balances,
  };
}

async function payerContractData() {
  const [payers, contracts, feeSchedules, feeLines] =
    await Promise.all([
      referenceRows("payers"),
      tenantRows("payer_contracts"),
      tenantRows("fee_schedules"),
      tenantRows("fee_schedule_lines"),
    ]);
  const payerMap = byId(payers);

  return {
    payers,
    contracts: contracts.map((row) => ({
      ...row,
      payerName: payerMap.get(row.payer_id)?.name ?? null,
    })),
    feeSchedules,
    feeScheduleLines: feeLines,
  };
}

async function importData() {
  const [batches, rows, errors] = await Promise.all([
    tenantRows("import_batches"),
    tenantRows("import_rows"),
    tenantRows("import_validation_errors"),
  ]);
  return { batches, rows, validationErrors: errors };
}

async function submissionData() {
  const [claims, batches, batchItems, submissions, responses] =
    await Promise.all([
      claimRows(),
      tenantRows("claim_batches"),
      tenantRows("claim_batch_items"),
      tenantRows("claim_submissions"),
      tenantRows("submission_responses"),
    ]);
  return { claims, batches, batchItems, submissions, responses };
}

async function followUpData() {
  const [workItems, denials, appeals, claims] = await Promise.all([
    workqueueRows(),
    tenantRows("denials"),
    tenantRows("appeals"),
    claimRows(),
  ]);
  return { workItems, denials, appeals, claims };
}

async function reportData() {
  const [dashboard, payments, denials, eligibility] =
    await Promise.all([
      dashboardData(),
      tenantRows("payments"),
      tenantRows("denials"),
      eligibilityRows(),
    ]);

  return {
    clients: dashboard.totalClients,
    activeProviders: dashboard.activeProviders,
    openClaims: dashboard.openClaims,
    deniedClaims: dashboard.deniedClaims,
    openWorkItems: dashboard.openWorkItems,
    openArCents: dashboard.totalOpenBalanceCents,
    payments: payments.length,
    denials,
    eligibility,
  };
}

async function preSessionData(appointmentId: string) {
  const [
    schedule,
    clients,
    providers,
    eligibility,
    authorization,
    diagnoses,
    notes,
  ] = await Promise.all([
    scheduleRows(),
    tenantRows("clients"),
    tenantRows("providers"),
    eligibilityRows(),
    authorizationData(),
    tenantRows("client_diagnoses"),
    tenantRows("clinical_notes"),
  ]);

  const appointment = schedule.find(
    (row) => row.id === appointmentId,
  );
  if (!appointment) throw new Error("Appointment not found.");

  return {
    appointment,
    client: clients.find(
      (row) => row.id === appointment.client_id,
    ),
    provider: providers.find(
      (row) => row.id === appointment.provider_id,
    ),
    eligibility: eligibility.filter(
      (row) => row.client_id === appointment.client_id,
    ),
    authorizations: authorization.authorizations.filter(
      (row) => row.client_id === appointment.client_id,
    ),
    diagnoses: diagnoses.filter(
      (row) => row.client_id === appointment.client_id,
    ),
    clinicalNotes: notes.filter(
      (row) => row.client_id === appointment.client_id,
    ),
  };
}

function isDirectPath(pathname: string) {
  return [
    "/api/dashboard",
    "/api/clients",
    "/api/providers",
    "/api/claims",
    "/api/workqueues",
    "/api/schedule",
    "/api/clinical",
    "/api/eligibility",
    "/api/authorizations",
    "/api/medicaid",
    "/api/charges",
    "/api/payments-overview",
    "/api/ar-denials",
    "/api/credentialing",
    "/api/payers-contracts",
    "/api/mailroom",
    "/api/imports",
    "/api/journal",
    "/api/claim-submission",
    "/api/claim-follow-up",
    "/api/reports",
  ].some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const url = new URL(
    path,
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost",
  );
  const pathname = url.pathname;

  if (pathname === "/api/dashboard") {
    return (await dashboardData()) as T;
  }

  if (pathname === "/api/clients") {
    return (await clientRows(url.searchParams.get("search") ?? "")) as T;
  }

  if (pathname.startsWith("/api/clients/")) {
    const id = pathname.split("/")[3];
    return (await clientDetail(id)) as T;
  }

  if (pathname === "/api/providers") {
    return (await providerRows()) as T;
  }

  if (pathname.startsWith("/api/providers/")) {
    const id = pathname.split("/")[3];
    return (await providerDetail(id)) as T;
  }

  if (pathname === "/api/claims") {
    let claims = await claimRows();
    const search = (url.searchParams.get("search") ?? "")
      .trim()
      .toLowerCase();
    const status = url.searchParams.get("status") ?? "";

    if (search) {
      claims = claims.filter((claim) =>
        [
          claim.patient_control_number,
          claim.payer_claim_number,
          claim.clientName,
          claim.payerName,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(search),
          ),
      );
    }

    if (status) {
      claims = claims.filter(
        (claim) => claim.claim_status === status,
      );
    }

    return claims as T;
  }

  if (pathname.startsWith("/api/claims/") &&
      !pathname.startsWith("/api/claims/submission") &&
      !pathname.startsWith("/api/claims/follow-up")) {
    const id = pathname.split("/")[3];
    return (await claimDetail(id)) as T;
  }

  if (pathname === "/api/workqueues") {
    return (await workqueueRows()) as T;
  }

  if (pathname === "/api/schedule") {
    return (await scheduleRows()) as T;
  }

  if (/^\/api\/schedule\/[^/]+\/pre-session$/.test(pathname)) {
    const id = pathname.split("/")[3];
    return (await preSessionData(id)) as T;
  }

  if (pathname === "/api/clinical") {
    const [clinicalNotes, treatmentPlans] = await Promise.all([
      tenantRows("clinical_notes"),
      tenantRows("treatment_plans"),
    ]);
    return { clinicalNotes, treatmentPlans } as T;
  }

  if (pathname === "/api/eligibility") {
    return (await eligibilityRows()) as T;
  }

  if (pathname === "/api/authorizations") {
    return (await authorizationData()) as T;
  }

  if (pathname === "/api/medicaid") {
    const [eligibility, authorizations] = await Promise.all([
      eligibilityRows(),
      authorizationData(),
    ]);
    return {
      eligibility,
      authorizations: authorizations.authorizations,
      authorizationUnits: authorizations.authorizationUnits,
    } as T;
  }

  if (pathname === "/api/charges") {
    return (await chargeRows()) as T;
  }

  if (pathname === "/api/payments-overview") {
    return (await paymentsOverview()) as T;
  }

  if (pathname === "/api/ar-denials") {
    return (await arDenialsData()) as T;
  }

  if (pathname === "/api/credentialing") {
    return (await credentialingData()) as T;
  }

  if (pathname === "/api/payers-contracts") {
    return (await payerContractData()) as T;
  }

  if (pathname === "/api/mailroom") {
    return [] as T;
  }

  if (pathname === "/api/imports") {
    return (await importData()) as T;
  }

  if (pathname === "/api/journal") {
    return [] as T;
  }

  if (pathname === "/api/claim-submission") {
    return (await submissionData()) as T;
  }

  if (pathname === "/api/claim-follow-up") {
    return (await followUpData()) as T;
  }

  if (pathname === "/api/reports") {
    return (await reportData()) as T;
  }


  throw new Error(`Unsupported direct Supabase route: ${pathname}`);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function installDirectSupabaseFetch() {
  if (typeof window === "undefined") return;

  const marker = "__therassistantDirectSupabaseFetch";
  const markedWindow = window as Window & Record<string, unknown>;
  if (markedWindow[marker]) return;
  markedWindow[marker] = true;

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(requestUrl, window.location.origin);
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    if (parsed.origin === window.location.origin) {
      if (method === "GET" && isDirectPath(parsed.pathname)) {
        try {
          return jsonResponse(
            await apiGet(`${parsed.pathname}${parsed.search}`),
          );
        } catch (error) {
          return jsonResponse(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to load Supabase data",
            },
            500,
          );
        }
      }

    }

    return nativeFetch(input, init);
  };
}

installDirectSupabaseFetch();

export async function parseApiResponse<T>(
  response: Response,
): Promise<T> {
  const bodyText = await response.text();
  const contentType =
    response.headers.get("content-type") ?? "";

  let body: unknown = null;

  if (bodyText && contentType.includes("application/json")) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Request failed with ${response.status}`;

    throw new Error(message);
  }

  if (!bodyText) {
    return undefined as T;
  }

  if (body === null) {
    throw new Error(
      "The server returned an invalid response.",
    );
  }

  return body as T;
}

export function useApi<T>(path: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    fetch(path, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => parseApiResponse<T>(response))
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load data",
        );

        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [path]);

  return {
    data,
    loading,
    error,
  };
}
