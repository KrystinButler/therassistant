import { useEffect, useMemo, useState } from "react";

import { shortDate } from "../../lib/format";
import { addOutcomeScore, getOutcomeScores } from "./repository";
import {
  buildOutcomeTrends,
  describeOutcomeTrend,
  instrumentLabel,
  type OutcomeInstrument,
} from "./workflow";

type DataRow = Record<string, unknown> & { id: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function OutcomeMeasuresPanel({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<DataRow[]>([]);
  const [instrumentCode, setInstrumentCode] = useState<OutcomeInstrument>("gad7");
  const [administeredDate, setAdministeredDate] = useState(todayIso());
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await getOutcomeScores(patientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load outcome scores.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [patientId]);

  const trends = useMemo(() => buildOutcomeTrends(rows), [rows]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (score.trim() === "") throw new Error("Outcome score is required.");
      await addOutcomeScore(patientId, {
        instrumentCode,
        administeredDate,
        totalScore: Number(score),
        notes,
      });
      setScore("");
      setNotes("");
      setMessage(instrumentLabel(instrumentCode) + " score recorded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save outcome score.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="thera-card thera-span-2">
    <div className="thera-card-header split">
      <div>
        <div className="thera-eyebrow">MEASUREMENT-BASED CARE</div>
        <h2>Outcome Measures</h2>
        <p>Record PHQ-9 and GAD-7 total scores and use longitudinal change as treatment-plan review evidence.</p>
      </div>
    </div>

    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

    <div className="thera-form-grid" style={{ marginBottom: 18 }}>
      <label className="thera-field">
        <span className="thera-field-label">Instrument</span>
        <select className="thera-input" value={instrumentCode} onChange={(event) => setInstrumentCode(event.target.value as OutcomeInstrument)}>
          <option value="gad7">GAD-7</option>
          <option value="phq9">PHQ-9</option>
        </select>
      </label>
      <label className="thera-field">
        <span className="thera-field-label">Assessment Date</span>
        <input className="thera-input" type="date" value={administeredDate} onChange={(event) => setAdministeredDate(event.target.value)} />
      </label>
      <label className="thera-field">
        <span className="thera-field-label">Total Score</span>
        <input className="thera-input" type="number" min={0} max={instrumentCode === "phq9" ? 27 : 21} step={1} value={score} onChange={(event) => setScore(event.target.value)} />
      </label>
      <label className="thera-field">
        <span className="thera-field-label">Clinical Note (optional)</span>
        <input className="thera-input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Context for this score" />
      </label>
      <div className="thera-span-2">
        <button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Record Score"}
        </button>
      </div>
    </div>

    {trends.length > 0 && <div className="thera-definition-grid" style={{ marginBottom: 18 }}>
      {trends.map((trend) => <div key={trend.instrumentCode}>
        <div className="thera-field-label">{trend.label} Trend</div>
        <div className="thera-field-value">{describeOutcomeTrend(trend)}</div>
      </div>)}
    </div>}

    {loading ? <div className="thera-state">Loading outcome scores...</div> :
      rows.length ? <div className="thera-table-wrap"><table className="thera-table">
        <thead><tr><th>Date</th><th>Instrument</th><th>Score</th><th>Source</th><th>Note</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{shortDate(String(row.administered_date ?? ""))}</td>
          <td>{String(row.instrument_code ?? "") === "phq9" ? "PHQ-9" : "GAD-7"}</td>
          <td><strong>{String(row.total_score ?? "—")}</strong></td>
          <td>{String(row.source ?? "—").replaceAll("_", " ")}</td>
          <td>{String(row.notes ?? "—")}</td>
        </tr>)}</tbody>
      </table></div> : <div className="thera-empty">No PHQ-9 or GAD-7 scores have been recorded.</div>}
  </section>;
}
