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

const ACTIVE_WORK = new Set(["open", "in_progress", "pending", "snoozed", "reopened"]);

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
