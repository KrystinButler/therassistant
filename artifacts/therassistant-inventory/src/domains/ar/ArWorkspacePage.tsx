import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getArWorkspaceData, type ArRow } from "./repository";

type Data = Awaited<ReturnType<typeof getArWorkspaceData>>;
type Tab = "insurance" | "patient" | "denials" | "appeals" | "variance" | "recovery";
const buckets = ["0-30", "31-60", "61-90", "91-120", "120+"] as const;

function initialTab(): Tab {
  const value = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
  return ["insurance", "patient", "denials", "appeals", "variance", "recovery"].includes(String(value)) ? value as Tab : "insurance";
}

export function ArWorkspacePage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [bucket, setBucket] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getArWorkspaceData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load A/R.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function chooseTab(value: Tab) {
    setTab(value);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/ar-denials?tab=${value}`);
  }

  const rows = tab === "patient" ? data?.patientAr ?? [] : data?.insuranceAr ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const text = [row.patient_control_number, row.clientName, row.payerName, row.providerName].join(" ").toLowerCase();
      return (!q || text.includes(q))
        && (!payer || row.payer_id === payer)
        && (!provider || row.rendering_provider_id === provider)
        && (!status || row.claim_status === status)
        && (!bucket || row.bucket === bucket);
    });
  }, [rows, search, payer, provider, status, bucket]);

  return (
    <>
      <div className="thera-page-header split">
        <div><div className="thera-eyebrow">REVENUE RECOVERY</div><h1>A/R & Denials</h1><p>Separate payer aging, patient responsibility, denials, appeals, underpayments, and recovery work.</p></div>
        <Link className="thera-action secondary" href="/billing">Back to Billing</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        {(["insurance", "patient", "denials", "appeals", "variance", "recovery"] as Tab[]).map((value) => <button key={value} type="button" className={tab === value ? "thera-tab active" : "thera-tab"} onClick={() => chooseTab(value)}>{value === "insurance" ? "Insurance A/R" : value === "patient" ? "Patient A/R" : value === "variance" ? "Underpayments" : value === "recovery" ? "Recoupments / Refunds" : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>

      {error && <div className="thera-state error">{error}</div>}
      {loading && <div className="thera-state">Loading A/R...</div>}

      {!loading && data && (tab === "insurance" || tab === "patient") && (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-metric-grid">
              {buckets.map((value) => {
                const bucketRows = rows.filter((row) => row.bucket === value);
                return <div className="thera-metric-card" key={value}><div className="thera-metric-label">{value}</div><div className="thera-metric-value">{bucketRows.length}</div><div className="thera-table-subtext">{money(bucketRows.reduce((sum, row) => sum + row.openBalanceCents, 0))}</div></div>;
              })}
            </div>
          </section>
          <section className="thera-card">
            <div className="thera-filter-row">
              <input className="thera-input" placeholder="Search claim, patient, payer..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="thera-input" value={payer} onChange={(e) => setPayer(e.target.value)}><option value="">All payers</option>{data.payers.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Payer")}</option>)}</select>
              <select className="thera-input" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">All providers</option>{data.providers.map((row) => <option key={row.id} value={row.id}>{[row.first_name, row.last_name].filter(Boolean).join(" ")}</option>)}</select>
              <select className="thera-input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Array.from(new Set(rows.map((row) => String(row.claim_status)))).sort().map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
              <select className="thera-input" value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="">All aging</option>{buckets.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
          </section>
          <ArTable rows={filtered} />
        </div>
      )}

      {!loading && data && tab === "denials" && <section className="thera-card"><div className="thera-card-header"><div><h2>Denials</h2><p>{data.denials.length} denial record(s). Lifecycle actions are added in the next Phase 3 task.</p></div></div></section>}
      {!loading && data && tab === "appeals" && <section className="thera-card"><div className="thera-card-header"><div><h2>Appeals</h2><p>{data.appeals.length} appeal record(s). Lifecycle actions are added in the next Phase 3 task.</p></div></div></section>}
      {!loading && data && tab === "variance" && <section className="thera-card"><div className="thera-empty">Contract variance analysis is added later in Phase 3.</div></section>}
      {!loading && data && tab === "recovery" && <section className="thera-card"><div className="thera-empty">Recoupment and refund recovery is added later in Phase 3.</div></section>}
    </>
  );
}

function ArTable({ rows }: { rows: ArRow[] }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No open balances match these filters.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>Age</th><th>Charge</th><th>Paid</th><th>Adjustments</th><th>Open</th><th>Status</th><th>Denial</th><th>Work</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><Link className="thera-table-link" href={`/claims/${row.id}`}>{String(row.patient_control_number ?? "Open")}</Link></td><td>{row.clientName}</td><td>{shortDate(String(row.service_date_from ?? ""))}</td><td>{row.payerName}</td><td>{row.providerName}</td><td>{row.daysOutstanding} days<div className="thera-table-subtext">{row.bucket}</div></td><td>{money(Number(row.total_charge_cents ?? 0))}</td><td>{money(row.paidAmountCents)}</td><td>{money(row.adjustmentAmountCents)}</td><td>{money(row.openBalanceCents)}</td><td><StatusBadge value={String(row.claim_status ?? "unknown")} /></td><td>{row.denialStatus}</td><td>{row.workStatus}</td></tr>)}</tbody></table></div></section>;
}
