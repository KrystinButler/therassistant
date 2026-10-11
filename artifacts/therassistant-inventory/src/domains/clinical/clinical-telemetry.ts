type Row = Record<string, unknown>;

export type ClinicalTelemetryPoint = {
  date: string;
  phq9?: number;
  gad7?: number;
  prsds?: number;
};

export type ClinicalTelemetrySnapshot = {
  label: "PHQ-9" | "GAD-7" | "PRSDS";
  key: "phq9" | "gad7" | "prsds";
  current: number | null;
  currentDate: string | null;
  previous: number | null;
  previousDate: string | null;
  trend: "up" | "down" | "same" | "new" | "none";
};

const SERIES_KEY = {
  "PHQ-9": "phq9",
  "GAD-7": "gad7",
  PRSDS: "prsds",
} as const;

function parseDateKey(value: unknown) {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function buildClinicalTelemetry(rows: Row[], asOfDate: string, rollingDays = 90): ClinicalTelemetryPoint[] {
  const endKey = parseDateKey(asOfDate);
  if (!endKey) return [];
  const end = new Date(`${endKey}T12:00:00Z`);
  if (!Number.isFinite(end.getTime())) return [];
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - rollingDays);
  const startKey = start.toISOString().slice(0, 10);

  const byDate = new Map<string, ClinicalTelemetryPoint>();
  for (const row of rows) {
    const instrument = String(row.instrument ?? "") as keyof typeof SERIES_KEY;
    const key = SERIES_KEY[instrument];
    if (!key) continue;
    const date = parseDateKey(row.assessed_on ?? row.created_at);
    if (!date || date < startKey || date > endKey) continue;
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    const point = byDate.get(date) ?? { date };
    point[key] = score;
    byDate.set(date, point);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestClinicalTelemetrySnapshot(rows: Row[], asOfDate: string): ClinicalTelemetrySnapshot[] {
  const points = buildClinicalTelemetry(rows, asOfDate);
  const series = [
    { label: "PHQ-9" as const, key: "phq9" as const },
    { label: "GAD-7" as const, key: "gad7" as const },
    { label: "PRSDS" as const, key: "prsds" as const },
  ];

  return series.map(({ label, key }) => {
    const scored = points
      .filter((point) => typeof point[key] === "number")
      .map((point) => ({ date: point.date, score: Number(point[key]) }));
    const current = scored.at(-1) ?? null;
    const previous = scored.at(-2) ?? null;
    let trend: ClinicalTelemetrySnapshot["trend"] = "none";
    if (current && !previous) trend = "new";
    if (current && previous) trend = current.score > previous.score ? "up" : current.score < previous.score ? "down" : "same";
    return {
      label,
      key,
      current: current?.score ?? null,
      currentDate: current?.date ?? null,
      previous: previous?.score ?? null,
      previousDate: previous?.date ?? null,
      trend,
    };
  });
}
