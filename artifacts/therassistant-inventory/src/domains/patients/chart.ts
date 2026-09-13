export type ChartRow = Record<string, unknown> & { id: string };

export type PatientReadinessInput = {
  patient: ChartRow;
  insurancePolicies: ChartRow[];
  payers: ChartRow[];
  appointments: ChartRow[];
  authorizations: ChartRow[];
  authorizationUnits: ChartRow[];
  workItems: ChartRow[];
  now?: Date;
};

export type PatientReadinessSummary = {
  registrationStatus: string;
  primaryPolicyId: string | null;
  primaryPayerName: string;
  nextAppointmentId: string | null;
  authorizationAlert: string;
  openWorkCount: number;
};

export type PatientChartAggregateInput = {
  patientId: string;
  patients: ChartRow[];
  contacts: ChartRow[];
  policies: ChartRow[];
  eligibility: ChartRow[];
  authorizations: ChartRow[];
  authorizationUnits: ChartRow[];
  appointments: ChartRow[];
  encounters: ChartRow[];
  treatmentPlans: ChartRow[];
  treatmentGoals: ChartRow[];
  notes: ChartRow[];
  charges: ChartRow[];
  claims: ChartRow[];
  payments: ChartRow[];
  denials: ChartRow[];
  documents: ChartRow[];
  checkins: ChartRow[];
  workItems: ChartRow[];
  providers: ChartRow[];
  payers: ChartRow[];
  plans: ChartRow[];
  balances: ChartRow[];
  now?: Date;
};

const ACTIVE_WORK = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);

function personName(row?: ChartRow | null) {
  if (!row) return "—";
  const preferred = String(row.preferred_name ?? "").trim();
  const first = preferred || String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ") || "—";
}

function mapById(rows: ChartRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function patientRows(rows: ChartRow[], patientId: string) {
  return rows.filter((row) => String(row.client_id ?? "") === patientId);
}

export function summarizePatientReadiness(input: PatientReadinessInput): PatientReadinessSummary {
  const now = input.now ?? new Date();
  const primaryPolicy =
    input.insurancePolicies.find(
      (row) => row.status === "active" && row.insurance_order === "primary",
    ) ?? input.insurancePolicies.find((row) => row.status === "active") ?? null;

  const payer = primaryPolicy
    ? input.payers.find((row) => row.id === String(primaryPolicy.payer_id ?? "")) ?? null
    : null;

  const nextAppointment = input.appointments
    .filter((row) => {
      const startsAt = new Date(String(row.starts_at ?? ""));
      const status = String(row.appointment_status ?? "");
      return Number.isFinite(startsAt.getTime()) && startsAt >= now && !["cancelled", "no_show", "completed"].includes(status);
    })
    .sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")))[0] ?? null;

  const activeAuthorization = input.authorizations.find(
    (row) =>
      row.status === "approved" &&
      (!primaryPolicy || !row.payer_id || row.payer_id === primaryPolicy.payer_id),
  ) ?? null;

  let authorizationAlert = "No active authorization";
  if (activeAuthorization) {
    const remaining = input.authorizationUnits
      .filter((row) => row.authorization_id === activeAuthorization.id)
      .reduce((sum, row) => sum + Number(row.remaining_units ?? 0), 0);
    authorizationAlert = `${remaining} units remaining`;
  }

  const openWorkCount = input.workItems.filter((row) =>
    ACTIVE_WORK.has(String(row.workqueue_status ?? "open")),
  ).length;

  return {
    registrationStatus: String(input.patient.registration_status ?? "not_started"),
    primaryPolicyId: primaryPolicy?.id ?? null,
    primaryPayerName: String(payer?.name ?? "—"),
    nextAppointmentId: nextAppointment?.id ?? null,
    authorizationAlert,
    openWorkCount,
  };
}

export function buildPatientChartAggregate(input: PatientChartAggregateInput) {
  const patient = input.patients.find((row) => row.id === input.patientId);
  if (!patient) throw new Error("Patient not found.");

  const providersById = mapById(input.providers);
  const payersById = mapById(input.payers);
  const plansById = mapById(input.plans);

  const contacts = patientRows(input.contacts, input.patientId);
  const insurancePolicies = patientRows(input.policies, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
    planName: String(plansById.get(String(row.payer_plan_id ?? ""))?.name ?? "—"),
  }));
  const eligibilityHistory = patientRows(input.eligibility, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const authorizations = patientRows(input.authorizations, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
    units: input.authorizationUnits.filter((unit) => unit.authorization_id === row.id),
  }));
  const appointments = patientRows(input.appointments, input.patientId).map((row) => ({
    ...row,
    providerName: personName(providersById.get(String(row.provider_id ?? ""))),
  }));
  const encounters = patientRows(input.encounters, input.patientId).map((row) => ({
    ...row,
    providerName: personName(providersById.get(String(row.provider_id ?? ""))),
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const treatmentPlans = patientRows(input.treatmentPlans, input.patientId).map((row) => ({
    ...row,
    providerName: personName(providersById.get(String(row.provider_id ?? ""))),
    goals: input.treatmentGoals.filter((goal) => goal.treatment_plan_id === row.id),
  }));
  const clinicalNotes = patientRows(input.notes, input.patientId).map((row) => ({
    ...row,
    providerName: personName(providersById.get(String(row.provider_id ?? ""))),
  }));
  const charges = patientRows(input.charges, input.patientId).map((row) => ({
    ...row,
    providerName: personName(providersById.get(String(row.provider_id ?? ""))),
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const claims = patientRows(input.claims, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const payments = patientRows(input.payments, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const denials = patientRows(input.denials, input.patientId).map((row) => ({
    ...row,
    payerName: String(payersById.get(String(row.payer_id ?? ""))?.name ?? "—"),
  }));
  const documents = patientRows(input.documents, input.patientId);
  const checkins = patientRows(input.checkins, input.patientId);
  const workItems = input.workItems.filter(
    (row) => row.source_object_type === "client" && row.source_object_id === input.patientId,
  );
  const openBalanceCents = Number(
    input.balances.find((row) => row.client_id === input.patientId)?.open_balance_cents ?? 0,
  );

  const summary = summarizePatientReadiness({
    patient,
    insurancePolicies,
    payers: input.payers,
    appointments,
    authorizations,
    authorizationUnits: input.authorizationUnits,
    workItems,
    now: input.now,
  });

  return {
    patient,
    contacts,
    insurancePolicies,
    eligibilityHistory,
    authorizations,
    appointments,
    encounters,
    treatmentPlans,
    clinicalNotes,
    charges,
    claims,
    payments,
    denials,
    documents,
    checkins,
    workItems,
    openBalanceCents,
    summary,
  };
}
