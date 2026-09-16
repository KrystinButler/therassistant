import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import {
  calculateContractVariance,
  expectedAllowedForLine,
  isRecoveryAdjustment,
} from "../ar/variance";

type DataRow = Row & { id: string };

export type PaymentVarianceRow = DataRow & {
  claimNumber: string;
  clientName: string;
  providerName: string;
  payerName: string;
  serviceDate: string;
  expectedAllowedCents: number;
  actualAllowedCents: number;
  varianceCents: number;
  matchedLineCount: number;
  workStatus: string;
  workItemId: string;
};

export type PaymentRecoveryRow = DataRow & {
  claimNumber: string;
  clientName: string;
  payerName: string;
  workStatus: string;
  workItemId: string;
};

const ACTIVE_WORK_STATUSES = ["open", "in_progress", "pending", "snoozed", "reopened"];

function personName(row?: Row) {
  if (!row) return "—";
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function activeOnDate(row: Row, date: string) {
  const effective = String(row.effective_date ?? "");
  const termination = String(row.termination_date ?? "");
  return (!effective || effective <= date) && (!termination || termination >= date);
}

function activeWorkFor(
  workItems: DataRow[],
  sourceType: string,
  sourceId: string,
  workTypes: string[],
) {
  return workItems.find((row) =>
    row.source_object_type === sourceType
    && row.source_object_id === sourceId
    && workTypes.includes(String(row.workqueue_type ?? ""))
    && ACTIVE_WORK_STATUSES.includes(String(row.workqueue_status ?? "")),
  );
}

async function addWorkHistory(workItemId: string, note: string, oldStatus?: string, newStatus?: string) {
  return demoInsert<DataRow>("workqueue_history", {
    workqueue_item_id: workItemId,
    old_status: oldStatus ?? null,
    new_status: newStatus ?? null,
    note,
  });
}

export async function getPaymentExceptionData(asOfDate = new Date().toISOString().slice(0, 10)) {
  const [
    claims,
    claimLines,
    clients,
    providers,
    payers,
    adjustments,
    workItems,
    payerContracts,
    feeSchedules,
    feeScheduleLines,
  ] = await Promise.all([
    demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
    demoSelect<DataRow>("professional_claim_lines", { order: "service_date.asc" }),
    demoSelect<DataRow>("clients"),
    demoSelect<DataRow>("providers"),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("adjustments", { order: "created_at.desc" }),
    demoSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
    demoSelect<DataRow>("payer_contracts", { order: "effective_date.desc" }),
    demoSelect<DataRow>("fee_schedules", { order: "effective_date.desc" }),
    demoSelect<DataRow>("fee_schedule_lines"),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));
  const claimsById = new Map(claims.map((row) => [row.id, row]));

  const variances = claims.flatMap((claim): PaymentVarianceRow[] => {
    const serviceDate = String(claim.service_date_from ?? claim.created_at ?? asOfDate).slice(0, 10);
    const payerId = String(claim.payer_id ?? "");
    const contract = payerContracts.find((row) =>
      row.payer_id === payerId && row.status === "active" && activeOnDate(row, serviceDate),
    );
    if (!contract) return [];
    const schedule = feeSchedules.find((row) =>
      row.payer_contract_id === contract.id && row.status === "active" && activeOnDate(row, serviceDate),
    );
    if (!schedule) return [];
    const scheduleLines = feeScheduleLines.filter((row) => row.fee_schedule_id === schedule.id);
    const lines = claimLines.filter((row) => row.claim_id === claim.id);
    let expectedAllowedCents = 0;
    let actualAllowedCents = 0;
    let matchedLineCount = 0;

    for (const line of lines) {
      const expected = expectedAllowedForLine(line, scheduleLines);
      if (expected === null || line.allowed_amount_cents === null || line.allowed_amount_cents === undefined) continue;
      const actual = Number(line.allowed_amount_cents);
      if (!Number.isFinite(actual) || actual < 0) continue;
      expectedAllowedCents += expected;
      actualAllowedCents += actual;
      matchedLineCount += 1;
    }

    if (!matchedLineCount) return [];
    const varianceCents = calculateContractVariance(expectedAllowedCents, actualAllowedCents);
    if (varianceCents <= 0) return [];
    const work = activeWorkFor(workItems, "claim", claim.id, ["contract_variance"]);

    return [{
      ...claim,
      claimNumber: String(claim.patient_control_number ?? "—"),
      clientName: personName(clientsById.get(String(claim.client_id))),
      providerName: personName(providersById.get(String(claim.rendering_provider_id))),
      payerName: String(payersById.get(payerId)?.name ?? "—"),
      serviceDate,
      expectedAllowedCents,
      actualAllowedCents,
      varianceCents,
      matchedLineCount,
      workStatus: String(work?.workqueue_status ?? "—"),
      workItemId: work?.id ?? "",
    }];
  });

  const recovery = adjustments
    .filter((row) =>
      isRecoveryAdjustment(row.adjustment_type)
      && !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
    )
    .map((adjustment): PaymentRecoveryRow => {
      const claim = claimsById.get(String(adjustment.claim_id ?? ""));
      const clientId = String(adjustment.client_id ?? claim?.client_id ?? "");
      const payerId = String(adjustment.payer_id ?? claim?.payer_id ?? "");
      const work = activeWorkFor(
        workItems,
        "adjustment",
        adjustment.id,
        ["refund_review", "overpayment_review", "credit_balance_review"],
      );
      return {
        ...adjustment,
        claimNumber: String(claim?.patient_control_number ?? "—"),
        clientName: personName(clientsById.get(clientId)),
        payerName: String(payersById.get(payerId)?.name ?? "—"),
        workStatus: String(work?.workqueue_status ?? "—"),
        workItemId: work?.id ?? "",
      };
    });

  return { variances, recovery };
}

export async function routeVarianceToWork(row: PaymentVarianceRow) {
  const existing = (await demoSelect<DataRow>("workqueue_items", {
    workqueue_type: "eq.contract_variance",
    source_object_type: "eq.claim",
    source_object_id: `eq.${row.id}`,
    workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
    limit: "1",
  }))[0];
  const description = `Expected allowed ${row.expectedAllowedCents} cents; actual allowed ${row.actualAllowedCents} cents; variance ${row.varianceCents} cents.`;
  if (existing) {
    const updated = await demoUpdate<DataRow>("workqueue_items", existing.id, {
      priority: "high",
      description,
    });
    await addWorkHistory(
      existing.id,
      "Contract variance refreshed from Payments underpayment analysis.",
      String(existing.workqueue_status ?? "open"),
      String(existing.workqueue_status ?? "open"),
    );
    return updated;
  }
  const created = await demoInsert<DataRow>("workqueue_items", {
    workqueue_type: "contract_variance",
    workqueue_status: "open",
    priority: "high",
    source_object_type: "claim",
    source_object_id: row.id,
    title: `Underpayment · ${row.claimNumber}`,
    description,
  });
  await addWorkHistory(created.id, "Underpayment work started from Payments.", undefined, "open");
  return created;
}

export async function routeRecoveryToWork(row: PaymentRecoveryRow) {
  const workqueueType = row.adjustment_type === "refund_correction" ? "refund_review" : "overpayment_review";
  const existing = (await demoSelect<DataRow>("workqueue_items", {
    workqueue_type: `eq.${workqueueType}`,
    source_object_type: "eq.adjustment",
    source_object_id: `eq.${row.id}`,
    workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
    limit: "1",
  }))[0];
  if (existing) return existing;
  const created = await demoInsert<DataRow>("workqueue_items", {
    workqueue_type: workqueueType,
    workqueue_status: "open",
    priority: "high",
    source_object_type: "adjustment",
    source_object_id: row.id,
    title: row.adjustment_type === "refund_correction"
      ? `Refund review · ${row.claimNumber}`
      : `Recoupment review · ${row.claimNumber}`,
    description: String(row.reason ?? "Review recovery adjustment and determine next action."),
  });
  await addWorkHistory(created.id, "Recovery work started from Payments.", undefined, "open");
  return created;
}
