type Row = Record<string, any>;

export type ReportSummaryRow = {
  label: string;
  count: number;
};

const terminalApplicationStatuses = new Set([
  "complete",
  "denied",
  "withdrawn",
  "terminated",
  "closed",
]);

export function applicationAgingBucket(ageDays: number): string {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  if (ageDays <= 120) return "91-120";
  return "120+";
}

export function buildApplicationAgingSummary(rows: Row[]): ReportSummaryRow[] {
  const labels = ["0-30", "31-60", "61-90", "91-120", "120+"];
  const counts = new Map(labels.map((label) => [label, 0]));

  for (const row of rows) {
    if (terminalApplicationStatuses.has(String(row.application_status || ""))) {
      continue;
    }

    const age = Number(row.application_age_days);
    if (!Number.isFinite(age) || age < 0) continue;
    const bucket = applicationAgingBucket(age);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return labels.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

function summarizeInFirstSeenOrder(
  rows: Row[],
  field: string,
): ReportSummaryRow[] {
  const result: ReportSummaryRow[] = [];
  const byValue = new Map<string, ReportSummaryRow>();

  for (const row of rows) {
    const raw = String(row[field] || "unknown");
    const label = raw.replaceAll("_", " ");
    const existing = byValue.get(raw);
    if (existing) {
      existing.count += 1;
      continue;
    }

    const summary = { label, count: 1 };
    byValue.set(raw, summary);
    result.push(summary);
  }

  return result;
}

export function buildParticipationSummary(rows: Row[]): ReportSummaryRow[] {
  return summarizeInFirstSeenOrder(rows, "participation_status");
}

export function buildRosterSummary(rows: Row[]): ReportSummaryRow[] {
  return summarizeInFirstSeenOrder(rows, "status");
}

export function buildExpirationSummary(
  rows: Row[],
  today = new Date(),
): ReportSummaryRow[] {
  const labels = ["Overdue", "Due 30 Days", "Due 60 Days", "Due 90 Days", "Later"];
  const counts = new Map(labels.map((label) => [label, 0]));
  const todayStart = new Date(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ).getTime();

  for (const row of rows) {
    if (!row.due_date) continue;
    const due = new Date(`${String(row.due_date).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) continue;

    const days = Math.ceil((due.getTime() - todayStart) / 86_400_000);
    const label =
      days < 0
        ? "Overdue"
        : days <= 30
          ? "Due 30 Days"
          : days <= 60
            ? "Due 60 Days"
            : days <= 90
              ? "Due 90 Days"
              : "Later";

    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return labels.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

function escapeCsv(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvText(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\r\n");
}

export function downloadCsv(
  fileName: string,
  headers: string[],
  rows: unknown[][],
): void {
  const blob = new Blob([csvText(headers, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
