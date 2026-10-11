import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildClinicalTelemetry, latestClinicalTelemetrySnapshot } from "./clinical-telemetry";

type Row = Record<string, unknown>;

type Props = {
  measures: Row[];
  asOfDate: string;
};

function formatShortDate(value: string | null) {
  if (!value) return "No result";
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year.slice(2)}`;
}

function trendText(trend: "up" | "down" | "same" | "new" | "none", previous: number | null) {
  if (trend === "up") return `↑ from ${previous}`;
  if (trend === "down") return `↓ from ${previous}`;
  if (trend === "same") return `→ unchanged from ${previous}`;
  if (trend === "new") return "New baseline";
  return "No prior result";
}

export function ClinicalTelemetryChart({ measures, asOfDate }: Props) {
  const data = buildClinicalTelemetry(measures, asOfDate);
  const latest = latestClinicalTelemetrySnapshot(measures, asOfDate);
  return <section className="clinical-telemetry clinical-telemetry-prominent" aria-label="90-day clinical telemetry">
    <div className="clinical-telemetry-heading">
      <div><span className="thera-eyebrow">90-DAY CLINICAL TELEMETRY</span><h3>PHQ-9 · GAD-7 · PRSDS</h3></div>
      <small>Patient-reported and standardized scores</small>
    </div>
    <div className="clinical-telemetry-latest" aria-label="Latest scores">
      <div className="clinical-telemetry-latest-heading"><strong>Latest scores</strong><span>Trend is the numeric direction from the previous recorded score.</span></div>
      <div className="clinical-telemetry-latest-grid">
        {latest.map((item) => <div className="clinical-telemetry-latest-card" key={item.key}>
          <span>{item.label}</span>
          <strong>{item.current ?? "No result"}</strong>
          <small>{formatShortDate(item.currentDate)}</small>
          <em>Trend: {trendText(item.trend, item.previous)}</em>
        </div>)}
      </div>
    </div>
    {data.length ? <div className="clinical-telemetry-chart">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} />
          <YAxis domain={[0, 27]} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="phq9" name="PHQ-9" connectNulls stroke="var(--thera-navy, #1f3547)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="gad7" name="GAD-7" connectNulls stroke="var(--thera-teal, #3b7f7a)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="prsds" name="PRSDS" connectNulls stroke="var(--thera-sage, #708f79)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="clinical-telemetry-empty">No PHQ-9, GAD-7, or PRSDS scores are recorded in this 90-day window.</p>}
  </section>;
}
