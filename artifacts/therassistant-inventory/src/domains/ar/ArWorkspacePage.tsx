import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import {
  createDenialAppeal,
  recordAppealOutcome,
  startDenialWork,
  submitAppeal,
  writeOffDenial,
} from "./denial-repository";
import {
  getArWorkspaceData,
  routeRecoveryToWork,
  routeVarianceToWork,
  type AppealWorkspaceRow,
  type ArRow,
  type DenialWorkspaceRow,
  type RecoveryWorkspaceRow,
  type VarianceWorkspaceRow,
} from "./repository";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  async function act(label: string, action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(label);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete A/R action.");
    } finally {
      setSaving(false);
    }
  }

  function startAppeal(denial: DenialWorkspaceRow) {
    const dueDate = window.prompt("Appeal deadline (YYYY-MM-DD)", String(denial.timely_filing_deadline ?? "")) ?? "";
    if (!dueDate) return;
    const levelText = window.prompt("Appeal level", "1") ?? "1";
    const notes = window.prompt("Appeal notes", String(denial.reason ?? "")) ?? "";
    void act("Appeal draft created.", () => createDenialAppeal(denial.id, Number(levelText), dueDate, notes));
  }

  function recordOutcome(appeal: AppealWorkspaceRow) {
    const value = (window.prompt("Outcome: approved, partially_approved, denied, or withdrawn", "approved") ?? "").trim();
    if (!["approved", "partially_approved", "denied", "withdrawn"].includes(value)) return;
    void act("Appeal outcome recorded.", () => recordAppealOutcome(appeal.id, value as "approved" | "partially_approved" | "denied" | "withdrawn"));
  }

  return (
    <>
      <div className="thera-page-header split">
        <div><div className="thera-eyebrow">REVENUE RECOVERY</div><h1>A/R & Denials</h1><p>Separate payer aging, patient responsibility, denials, appeals, underpayments, and recovery work.</p></div>
        <Link className="thera-action secondary" href="/billing">Back to Billing</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        {(["insurance", "patient", "denials", "appeals", "variance", "recovery"] as Tab[]).map((value) => <button key={value} type="button" className={tab === value ? "thera-tab active" : "thera-tab"} onClick={() => chooseTab(value)}>{value === "insurance" ? "Insurance A/R" : value === "patient" ? "Patient A/R" : value === "variance" ? "Underpayments" : value === "recovery" ? "Recoupments / Refunds" : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
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

      {!loading && data && tab === "denials" && <DenialsTable rows={data.denials} saving={saving} onStart={(row) => void act("Denial work started.", () => startDenialWork(row.id))} onAppeal={startAppeal} onWriteOff={(row) => void act("Denial written off under configured policy.", () => writeOffDenial(row.id))} />}
      {!loading && data && tab === "appeals" && <AppealsTable rows={data.appeals} saving={saving} onSubmit={(row) => void act("Appeal submitted.", () => submitAppeal(row.id))} onOutcome={recordOutcome} />}
      {!loading && data && tab === "variance" && <VarianceTable rows={data.variances} saving={saving} onRoute={(row) => void act("Underpayment routed to Work Center.", () => routeVarianceToWork(row))} />}
      {!loading && data && tab === "recovery" && <RecoveryTable rows={data.recovery} saving={saving} onRoute={(row) => void act("Recovery review routed to Work Center.", () => routeRecoveryToWork(row))} />}
    </>
  );
}

function ArTable({ rows }: { rows: ArRow[] }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No open balances match these filters.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>Age</th><th>Charge</th><th>Paid</th><th>Adjustments</th><th>Open</th><th>Status</th><th>Denial</th><th>Work</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><Link className="thera-table-link" href={`/claims/${row.id}`}>{String(row.patient_control_number ?? "Open")}</Link></td><td>{row.clientName}</td><td>{shortDate(String(row.service_date_from ?? ""))}</td><td>{row.payerName}</td><td>{row.providerName}</td><td>{row.daysOutstanding} days<div className="thera-table-subtext">{row.bucket}</div></td><td>{money(Number(row.total_charge_cents ?? 0))}</td><td>{money(row.paidAmountCents)}</td><td>{money(row.adjustmentAmountCents)}</td><td>{money(row.openBalanceCents)}</td><td><StatusBadge value={String(row.claim_status ?? "unknown")} /></td><td>{row.denialStatus}</td><td>{row.workStatus}</td></tr>)}</tbody></table></div></section>;
}

function DenialsTable({ rows, saving, onStart, onAppeal, onWriteOff }: { rows: DenialWorkspaceRow[]; saving: boolean; onStart: (row: DenialWorkspaceRow) => void; onAppeal: (row: DenialWorkspaceRow) => void; onWriteOff: (row: DenialWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No denials.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>Payer</th><th>Category</th><th>CARC / RARC</th><th>Reason</th><th>Amount</th><th>Workability</th><th>Status</th><th>Deadline</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${String(row.claim_id)}`}>{row.claimNumber}</Link> : row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{row.payerName}</td><td>{String(row.denial_category ?? "other").replaceAll("_", " ")}</td><td>{String(row.carc_code ?? "—")} / {String(row.rarc_code ?? "—")}</td><td>{String(row.reason ?? "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.workability ?? row.policy)} /></td><td><StatusBadge value={String(row.denial_status ?? "new")} /></td><td>{row.timely_filing_deadline ? shortDate(String(row.timely_filing_deadline)) : "—"}</td><td><div className="thera-filter-row">{row.policy === "auto_writeoff" ? <button type="button" className="thera-action" disabled={saving || row.denial_status === "resolved_writeoff"} onClick={() => onWriteOff(row)}>Write Off</button> : <><button type="button" className="thera-action secondary" disabled={saving} onClick={() => onStart(row)}>Start Work</button><button type="button" className="thera-action" disabled={saving || Boolean(row.activeAppealId)} onClick={() => onAppeal(row)}>{row.activeAppealId ? "Appeal Active" : "Create Appeal"}</button></>}</div></td></tr>)}</tbody></table></div></section>;
}

function AppealsTable({ rows, saving, onSubmit, onOutcome }: { rows: AppealWorkspaceRow[]; saving: boolean; onSubmit: (row: AppealWorkspaceRow) => void; onOutcome: (row: AppealWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No appeals.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>Payer</th><th>Category</th><th>Level</th><th>Status</th><th>Due</th><th>Submitted</th><th>Outcome</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${String(row.claim_id)}`}>{row.claimNumber}</Link> : row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{row.payerName}</td><td>{row.denialCategory.replaceAll("_", " ")}</td><td>{String(row.appeal_level ?? "—")}</td><td><StatusBadge value={String(row.appeal_status ?? "not_started")} /></td><td>{row.deadline_date ? shortDate(String(row.deadline_date)) : "—"}</td><td>{row.submitted_at ? shortDate(String(row.submitted_at)) : "—"}</td><td>{String(row.outcome ?? "—").replaceAll("_", " ")}</td><td><div className="thera-filter-row">{["not_started", "drafting"].includes(String(row.appeal_status)) && <button className="thera-action" type="button" disabled={saving} onClick={() => onSubmit(row)}>Submit</button>}{["submitted", "pending"].includes(String(row.appeal_status)) && <button className="thera-action secondary" type="button" disabled={saving} onClick={() => onOutcome(row)}>Record Outcome</button>}</div></td></tr>)}</tbody></table></div></section>;
}

function VarianceTable({ rows, saving, onRoute }: { rows: VarianceWorkspaceRow[]; saving: boolean; onRoute: (row: VarianceWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No contract underpayments are currently identified. Variance requires an active contract, active fee schedule, matched claim line, and payer allowed amount.</div></section>;
  const totalVariance = rows.reduce((sum, row) => sum + row.varianceCents, 0);
  return <div className="thera-stack"><section className="thera-card"><div className="thera-metric-grid"><div className="thera-metric-card"><div className="thera-metric-label">Underpaid Claims</div><div className="thera-metric-value">{rows.length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Recoverable Variance</div><div className="thera-metric-value">{money(totalVariance)}</div></div></div></section><section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>Matched Lines</th><th>Expected Allowed</th><th>Actual Allowed</th><th>Underpayment</th><th>Work</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><Link className="thera-table-link" href={`/claims/${row.id}`}>{row.claimNumber}</Link><div className="thera-table-subtext">{row.clientName}</div></td><td>{shortDate(row.serviceDate)}</td><td>{row.payerName}</td><td>{row.providerName}</td><td>{row.matchedLineCount}</td><td>{money(row.expectedAllowedCents)}</td><td>{money(row.actualAllowedCents)}</td><td>{money(row.varianceCents)}</td><td><StatusBadge value={row.workStatus} /></td><td><button type="button" className="thera-action" disabled={saving || Boolean(row.workItemId)} onClick={() => onRoute(row)}>{row.workItemId ? "In Work Center" : "Route to Work"}</button></td></tr>)}</tbody></table></div></section></div>;
}

function RecoveryTable({ rows, saving, onRoute }: { rows: RecoveryWorkspaceRow[]; saving: boolean; onRoute: (row: RecoveryWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No recoupment or refund-correction adjustments require recovery review.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Type</th><th>Claim / Patient</th><th>Payer</th><th>Amount</th><th>Status</th><th>Reason</th><th>Work</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(String(row.adjustment_date ?? row.created_at ?? ""))}</td><td>{String(row.adjustment_type ?? "").replaceAll("_", " ")}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${String(row.claim_id)}`}>{row.claimNumber}</Link> : row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{row.payerName}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.adjustment_status ?? "pending")} /></td><td>{String(row.reason ?? "—")}</td><td><StatusBadge value={row.workStatus} /></td><td><button type="button" className="thera-action secondary" disabled={saving || Boolean(row.workItemId)} onClick={() => onRoute(row)}>{row.workItemId ? "In Work Center" : "Create Review"}</button></td></tr>)}</tbody></table></div></section>;
}
