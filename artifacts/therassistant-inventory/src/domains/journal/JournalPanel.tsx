import { useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import { addJournalEntry, flagJournalEntry, markJournalReviewed } from "./repository";

export function JournalPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [entryText, setEntryText] = useState("");
  const [mood, setMood] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true); setError(null);
    try {
      await addJournalEntry(chart.patient.id, { entryText, mood });
      setEntryText(""); setMood(""); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add journal entry."); }
    finally { setSaving(false); }
  }

  async function update(action: "review" | "flag", id: string) {
    setError(null);
    try {
      if (action === "review") await markJournalReviewed(id);
      else await flagJournalEntry(id);
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to update journal entry."); }
  }

  return <section className="thera-card">
    <div className="thera-card-header"><div><h2>Patient Journal</h2><p>Patient-authored reflections remain separate from signed clinical documentation unless a clinician deliberately incorporates relevant information.</p></div></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    <div className="thera-form-grid" style={{ marginBottom: 18 }}>
      <label className="thera-field"><span className="thera-field-label">Mood / Theme</span><input className="thera-input" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Optional" /></label>
      <label className="thera-field thera-span-2"><span className="thera-field-label">New Journal Entry</span><textarea className="thera-input" rows={4} value={entryText} onChange={(e) => setEntryText(e.target.value)} /></label>
      <div className="thera-span-2"><button type="button" className="thera-action" disabled={saving || !entryText.trim()} onClick={() => void add()}>{saving ? "Saving..." : "Add Patient Entry"}</button></div>
    </div>
    {chart.journalEntries.length ? <div className="thera-stack">{chart.journalEntries.map((row) => <article key={row.id} className="thera-work-card"><div className="thera-work-card-top"><div><strong>{String(row.mood ?? "Journal entry")}</strong><div className="thera-table-subtext">{dateTime(String(row.created_at ?? ""))} · Patient-authored</div></div><StatusBadge value={String(row.review_status ?? "unreviewed")} /></div><p>{String(row.entry_text ?? "")}</p><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={row.review_status === "reviewed"} onClick={() => void update("review", row.id)}>Mark Reviewed</button><button type="button" className="thera-action secondary" onClick={() => void update("flag", row.id)}>Flag</button></div></article>)}</div> : <div className="thera-empty">No journal entries yet.</div>}
  </section>;
}
