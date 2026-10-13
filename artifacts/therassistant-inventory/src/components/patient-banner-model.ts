export type PatientBannerRow = Record<string, unknown> & { id: string };

export type PatientBannerInput = {
  patient: PatientBannerRow;
  payerName?: string | null;
  eligibilityStatus?: string | null;
  openBalanceCents?: number | null;
  nextVisit?: string | null;
};

export type PatientBannerModel = {
  patientId: string;
  name: string;
  dob: string;
  pronouns: string;
  mrn: string;
  patientStatus: string;
  payerName: string;
  eligibilityStatus: string;
  balanceLabel: string;
  nextVisitLabel: string;
};

function text(value: unknown) {
  const valueText = String(value ?? "").trim();
  return valueText || "—";
}

function dateLabel(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const [year, month, day] = raw.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  return `${month}/${day}/${year}`;
}

function nextVisitLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function buildPatientBannerModel(input: PatientBannerInput): PatientBannerModel {
  const preferred = String(input.patient.preferred_name ?? "").trim();
  const first = preferred || String(input.patient.first_name ?? "").trim();
  const last = String(input.patient.last_name ?? "").trim();
  const name = [first, last].filter(Boolean).join(" ") || "Patient";
  const balance = input.openBalanceCents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(input.openBalanceCents / 100);

  return {
    patientId: input.patient.id,
    name,
    dob: dateLabel(input.patient.date_of_birth),
    pronouns: text(input.patient.pronouns),
    mrn: text(input.patient.medical_record_number ?? input.patient.mrn),
    patientStatus: String(input.patient.client_status ?? "active"),
    payerName: text(input.payerName),
    eligibilityStatus: String(input.eligibilityStatus ?? "unknown"),
    balanceLabel: balance,
    nextVisitLabel: nextVisitLabel(input.nextVisit),
  };
}
