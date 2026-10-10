import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildClinicalTelemetry } from "./clinical-telemetry";

type Row = Record<string, unknown>;

type Props = {
  measures: Row[];
  asOfDate: string;
};

export function ClinicalTelemetryChart({ measures, asOfDate }: Props) {
  const data = buildClinicalTelemetry(measures, asOfDate);
  return <section className="clinical-telemetry" aria-label="90-day clinical telemetry">
    <div className="clinical-telemetry-heading">
      <div><span className="thera-eyebrow">90-DAY CLINICAL TELEMETRY</span><h3>PHQ-9 · GAD-7 · PRSDS</h3></div>
      <small>Patient-reported and standardized scores</small>
    </div>
    {data.length ? <div className="clinical-telemetry-chart">
      <ResponsiveContainer width="100%" height={230}>
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
