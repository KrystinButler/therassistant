import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  evaluatePortalAccess,
  mergePreVisitResponses,
  planCheckInUpdate,
  type CheckInStep,
  type JournalEntryDraft,
  type PortalRow,
} from "./workflow";

type DataRow = Row & { id: string };

type SavePreVisitOptions = {
  markCheckedIn?: boolean;
};

function tenantSettings(row?: Row | null) {
  const settings = row?.settings;
  return settings && typeof settings === "object"
    ? (settings as Record<string, unknown>)
    : {};
}

async function patientRecord(patientId: string) {
  const rows = await demoSelect<DataRow>("clients", {
    id: `eq.${patientId}`,
    limit: "1",
  });
  const patient = rows[0];
  if (!patient) throw new Error("Patient not found.");
  return patient;
}

export async function recordCheckIn(
  appointmentId: string,
  patientId: string,
  step: CheckInStep,
  responses?: Record<string, unknown>,
) {
  const existing = await demoSelect<DataRow>("client_checkins", {
    appointment_id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  const currentResponses = existing[0]?.responses;
  const values: Row = {
    ...planCheckInUpdate(step),
    ...(responses
      ? { responses: mergePreVisitResponses(currentResponses, responses) }
      : {}),
  };
  return existing[0]
    ? demoUpdate<DataRow>("client_checkins", existing[0].id, values)
    : demoInsert<DataRow>("client_checkins", {
        appointment_id: appointmentId,
        client_id: patientId,
        responses: responses ?? {},
        ...values,
      });
}

export async function savePreVisitResponses(
  appointmentId: string,
  patientId: string,
  patch: Record<string, unknown>,
  options: SavePreVisitOptions = {},
) {
  const appointments = await demoSelect<DataRow>("appointments", {
    id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  if (!appointments[0]) {
    throw new Error("This appointment is not available in the patient portal.");
  }

  const existing = await demoSelect<DataRow>("client_checkins", {
    appointment_id: `eq.${appointmentId}`,
    client_id: `eq.${patientId}`,
    limit: "1",
  });
  const responses = mergePreVisitResponses(existing[0]?.responses, patch);
  const values: Row = { responses };
  if (options.markCheckedIn) {
    values.checked_in_at = new Date().toISOString();
  }

  return existing[0]
    ? demoUpdate<DataRow>("client_checkins", existing[0].id, values)
    : demoInsert<DataRow>("client_checkins", {
        appointment_id: appointmentId,
        client_id: patientId,
        ...values,
      });
}

export function saveJournalEntry(patientId: string, input: JournalEntryDraft) {
  return demoInsert<DataRow>("patient_journal_entries", {
    client_id: patientId,
    ...buildJournalEntryValues(input),
  });
}

export function addJournalEntry(
  patientId: string,
  input: { entryText: string; mood?: string },
) {
  return saveJournalEntry(patientId, input);
}

export async function requestPaymentPlan(
  patientId: string,
  monthlyAmountCents: number,
) {
  if (!Number.isInteger(monthlyAmountCents) || monthlyAmountCents <= 0) {
    throw new Error("Enter a valid monthly payment amount.");
  }

  const patient = await patientRecord(patientId);
  return demoInsert<DataRow>("patient_payment_plans", {
    client_id: patientId,
    tenant_id: String(patient.tenant_id ?? ""),
    requested_monthly_amount_cents: monthlyAmountCents,
    status: "pending",
  });
}

export async function requestBalanceException(patientId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Explain why you are requesting an exception.");

  const patient = await patientRecord(patientId);
  return demoInsert<DataRow>("portal_balance_exception_requests", {
    client_id: patientId,
    tenant_id: String(patient.tenant_id ?? ""),
    reason: trimmed,
    status: "pending",
  });
}

export async function getPatientPortalData(patientId: string) {
  const [
    patients,
    appointments,
    policies,
    documents,
    checkins,
    journalEntries,
    balances,
    treatmentPlans,
    treatmentGoals,
    paymentPlans,
    exceptionRequests,
  ] = await Promise.all([
    demoSelect<DataRow>("clients", { id: `eq.${patientId}`, limit: "1" }),
    demoSelect<DataRow>("appointments", {
      client_id: `eq.${patientId}`,
      order: "starts_at.asc",
    }),
    demoSelect<DataRow>("client_insurance_policies", {
      client_id: `eq.${patientId}`,
      order: "created_at.asc",
    }),
    demoSelect<DataRow>("documents", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("client_checkins", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("patient_journal_entries", {
      client_id: `eq.${patientId}`,
      order: "entry_date.desc,created_at.desc",
    }),
    demoSelect<DataRow>("client_balance_summaries", {
      client_id: `eq.${patientId}`,
      limit: "1",
    }),
    demoSelect<DataRow>("treatment_plans", {
      client_id: `eq.${patientId}`,
      order: "effective_date.desc,created_at.desc",
    }),
    demoSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
    demoSelect<DataRow>("patient_payment_plans", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("portal_balance_exception_requests", {
      client_id: `eq.${patientId}`,
      order: "created_at.desc",
    }),
  ]);

  const patient = patients[0];
  if (!patient) throw new Error("Patient not found.");

  const tenantId = String(patient.tenant_id ?? "");
  const tenants = tenantId
    ? await referenceSelect<DataRow>("tenants", {
        id: `eq.${tenantId}`,
        limit: "1",
      })
    : [];
  const settings = tenantSettings(tenants[0]);
  const thresholdValue = Number(settings.portal_balance_threshold_cents);
  const thresholdCents = Number.isFinite(thresholdValue) ? thresholdValue : null;
  const base = buildPatientPortalData({
    patient: patient as PortalRow,
    appointments: appointments as PortalRow[],
    policies: policies as PortalRow[],
    documents: documents as PortalRow[],
    checkins: checkins as PortalRow[],
    journalEntries: journalEntries as PortalRow[],
    balance: (balances[0] as PortalRow | undefined) ?? null,
  });

  const planIds = new Set(treatmentPlans.map((row) => row.id));
  const patientGoals = treatmentGoals.filter((row) =>
    planIds.has(String(row.treatment_plan_id ?? "")),
  );
  const activePaymentPlan = paymentPlans.some((row) => row.status === "active");
  const approvedException = exceptionRequests.some((row) => row.status === "approved");

  return {
    ...base,
    appointments,
    treatmentPlans,
    treatmentGoals: patientGoals,
    paymentPlans,
    exceptionRequests,
    portalAccess: evaluatePortalAccess({
      openBalanceCents: base.openBalanceCents,
      thresholdCents,
      activePaymentPlan,
      approvedException,
    }),
  };
}
