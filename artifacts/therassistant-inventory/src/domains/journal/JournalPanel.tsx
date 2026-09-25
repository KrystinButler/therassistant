import { useState } from "react";
import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import { flagJournalEntry, markJournalReviewed } from "./repository";

export function JournalPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(action: "review" | "flag", id: string) {
    setWorkingId(id);
    setError(null);
    try {
      if (action === "review") await markJournalReviewed(id);
      else await flagJournalEntry(id);
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to update journal entry."); }
    finally { setWorkingId(null); }
  }

  return <section className="thera-card">
    <div className="thera-card-header"><div><h2>Patient Journal</h2><p>Only patients can write journal entries in their own portal. Staff may review entries the patient shared with the practice, but cannot create or modify patient-authored text.</p></div></div>
    {error && <div className="thera-state error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
    {chart.journalEntries.length ? <div className="thera-stack">{chart.journalEntries.map((row) => <article key={row.id} className="thera-work-card"><div className="thera-work-card-top"><div><strong>{String(row.mood ?? "Journal entry")}</strong><div className="thera-table-subtext">{dateTime(String(row.created_at ?? ""))} · {row.recorded_by_staff_user_id ? "Legacy staff-transcribed patient report" : "Patient-authored"}</div></div><StatusBadge value={String(row.review_status ?? "unreviewed")} /></div><p>{String(row.entry_text ?? "")}</p><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={workingId === row.id || row.review_status === "reviewed"} onClick={() => void update("review", row.id)}>Mark Reviewed</button><button type="button" className="thera-action secondary" disabled={workingId === row.id} onClick={() => void update("flag", row.id)}>Flag</button></div></article>)}</div> : <div className="thera-empty">No patient-shared journal entries yet. Patients write entries in their own portal.</div>}
  </section>;
}
