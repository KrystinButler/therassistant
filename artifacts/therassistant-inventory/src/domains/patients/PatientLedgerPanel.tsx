import { useEffect, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getPatientAccountingActivity } from "./patient-ledger";

type Activity = Awaited<ReturnType<typeof getPatientAccountingActivity>>;

export function PatientLedgerPanel({ clientId, active }: { clientId: string; active: boolean }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !clientId || loadedFor === clientId) return;
    let current = true;
    setLoading(true);
    setError(null);
    void getPatientAccountingActivity(clientId).then((value) => {
      if (current) { setActivity(value); setLoadedFor(clientId); }
    }).catch((err: unknown) => {
      if (current) setError(err instanceof Error ? err.message : "Unable to load patient accounting.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, clientId, loadedFor]);

  return <div className="thera-stack">
    <section className="thera-card">
      <div className="thera-card-header split"><div><h2>Patient Ledger</h2><p>Account-level debits and credits from posted financial activity. The patient balance summary above remains the A/R source of truth.</p></div><button className="thera-action secondary" type="button" disabled={loading} onClick={() => setLoadedFor("")}>Refresh</button></div>
      {loading && <div className="thera-state">Loading ledger activity...</div>}
      {error && <div className="thera-state error" role="alert">{error}</div>}
      {!loading && activity && loadedFor === clientId && (activity.entries.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Posted</th><th>Account</th><th>Source</th><th>Period</th><th>Debit / Credit</th><th>Amount</th><th>Claim</th></tr></thead><tbody>{activity.entries.map((row) => <tr key={row.id}><td>{shortDate(String(row.posting_date ?? ""))}</td><td>{row.accountName}</td><td>{row.sourceType.replaceAll("_", " ")}</td><td>{row.periodName}{row.periodStatus === "closed" ? " (closed)" : ""}</td><td><StatusBadge value={String(row.side ?? "unknown")} /></td><td>{money(Number(row.amount_cents ?? 0))}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>Claim 360</Link> : "—"}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No posted ledger entries for this patient.</div>)}
      {loadedFor === clientId && activity?.entries.length === 150 && <p className="thera-table-subtext">Showing the 150 most recent entries.</p>}
    </section>
    <section className="thera-card">
      <div className="thera-card-header"><div><h2>Historical Imported Activity</h2><p>Imported transactions retain their original service dates, procedure codes, sources, and posting status.</p></div></div>
      {!loading && activity && loadedFor === clientId && (activity.history.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Transaction Date</th><th>Service Date</th><th>CPT / HCPCS</th><th>Type</th><th>Amount</th><th>Status</th><th>Source / Reference</th></tr></thead><tbody>{activity.history.map((row) => <tr key={row.id}><td>{shortDate(String(row.transaction_date ?? ""))}</td><td>{row.service_date ? shortDate(String(row.service_date)) : "—"}</td><td>{String(row.procedure_code ?? "—")}</td><td>{String(row.transaction_type ?? "—").replaceAll("_", " ")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.transaction_status ?? "unknown")} /></td><td>{String(row.legacy_claim_number ?? row.remittance_trace ?? row.legacy_source ?? "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No historical imports for this patient.</div>)}
      {loadedFor === clientId && activity?.history.length === 100 && <p className="thera-table-subtext">Showing the 100 most recent historical transactions.</p>}
    </section>
  </div>;
}
