import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { buildClaimWorkqueues } from "./workqueues";
import {
  bulkValidateClaims,
  createClaimFollowUps,
  getClaimsWorkspaceData,
  retryRejectedClaims,
  type ClaimsWorkspaceRow,
} from "./workspace-repository";

type Data = Awaited<ReturnType<typeof getClaimsWorkspaceData>>;
type Tab = "overview" | "list" | "workqueues" | "rejections" | "denials" | "appeals" | "reports";

export function ClaimsWorkspacePage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [payer, setPayer] = useState("");
  const [provider, setProvider] = useState("");
  const [cpt, setCpt] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [sort, setSort] = useState<"dos_desc" | "balance_desc">("dos_desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getClaimsWorkspaceData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load claims workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const queues = useMemo(
    () => data ? buildClaimWorkqueues(data.claims, data.responses, data.denials, data.paymentSignals) : null,
    [data],
  );

  const appealClaimIds = useMemo(
    () => new Set((data?.appeals ?? []).filter((row) => !["closed", "withdrawn"].includes(String(row.appeal_status ?? ""))).map((row) => String(row.claim_id ?? ""))),
    [data],
  );

  const baseRows = useMemo((): ClaimsWorkspaceRow[] => {
    if (!data || !queues) return [];
    if (tab === "rejections") return queues.rejections as ClaimsWorkspaceRow[];
    if (tab === "denials") return queues.denials as ClaimsWorkspaceRow[];
    if (tab === "appeals") return data.claims.filter((row) => appealClaimIds.has(row.id));
    if (tab === "workqueues") {
      const ids = new Set([...queues.validation, ...queues.submission, ...queues.rejections, ...queues.denials, ...queues.paymentExceptions].map((row) => row.id));
      return data.claims.filter((row) => ids.has(row.id));
    }
    return data.claims;
  }, [data, queues, tab, appealClaimIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = baseRows.filter((row) => {
      const haystack = [row.patient_control_number, row.payer_claim_number, row.clientName, row.payerName, row.providerName].join(" ").toLowerCase();
      return (!q || haystack.includes(q))
        && (!status || row.claim_status === status)
        && (!payer || row.payer_id === payer)
        && (!provider || row.rendering_provider_id === provider)
        && (!cpt || row.cptCodes.some((code) => code.toLowerCase().includes(cpt.toLowerCase())))
        && (!diagnosis || row.diagnosisCodes.some((code) => code.toLowerCase().includes(diagnosis.toLowerCase())));
    });
    rows.sort((a, b) => sort === "balance_desc"
      ? b.openBalanceCents - a.openBalanceCents
      : String(b.service_date_from ?? "").localeCompare(String(a.service_date_from ?? "")));
    return rows;
  }, [baseRows, search, status, payer, provider, cpt, diagnosis, sort]);

  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab, search, status, payer, provider, cpt, diagnosis, sort]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runBulk(action: "validate" | "followup" | "retry") {
    const chosen = data?.claims.filter((row) => selected.has(row.id)) ?? [];
    if (!chosen.length) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (action === "validate") {
        const ids = chosen.filter((row) => ["ready_for_validation", "validation_failed"].includes(String(row.claim_status))).map((row) => row.id);
        await bulkValidateClaims(ids);
        setMessage(`${ids.length} claim(s) sent through validation.`);
      } else if (action === "retry") {
        const ids = chosen.filter((row) => row.claim_status === "rejected").map((row) => row.id);
        await retryRejectedClaims(ids);
        setMessage(`${ids.length} rejected claim(s) returned to validation.`);
      } else {
        await createClaimFollowUps(chosen.map((row) => row.id));
        setMessage(`${chosen.length} claim follow-up item(s) created or retained.`);
      }
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete bulk claim action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLAIM OPERATIONS</div>
          <h1>Claims</h1>
          <p>Validation, submission, clearinghouse exceptions, denials, appeals, and claim-level financial status.</p>
        </div>
        <Link className="thera-action" href="/claims/submission">837P Submission</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        {(["overview", "list", "workqueues", "rejections", "denials", "appeals", "reports"] as Tab[]).map((value) => (
          <button key={value} type="button" className={tab === value ? "thera-tab active" : "thera-tab"} onClick={() => setTab(value)}>{value === "list" ? "Claims List" : value[0].toUpperCase() + value.slice(1)}</button>
        ))}
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading claims...</div>}

      {!loading && data && queues && tab === "overview" && (
        <section className="thera-card">
          <div className="thera-metric-grid">
            <Metric label="All Claims" count={data.claims.length} amount={data.claims.reduce((sum, row) => sum + row.openBalanceCents, 0)} />
            <Metric label="Validation" count={queues.validation.length} />
            <Metric label="Submission" count={queues.submission.length} />
            <Metric label="Rejections" count={queues.rejections.length} />
            <Metric label="Denials" count={queues.denials.length} />
            <Metric label="Appeals" count={appealClaimIds.size} />
          </div>
        </section>
      )}

      {!loading && data && tab === "reports" && (
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Claims Snapshot</h2><p>Operational totals from the current claim ledger.</p></div></div>
          <div className="thera-metric-grid">
            <Metric label="Charges" count={data.claims.length} amount={data.claims.reduce((sum, row) => sum + Number(row.total_charge_cents ?? 0), 0)} />
            <Metric label="Paid" count={data.claims.filter((row) => row.paidAmountCents > 0).length} amount={data.claims.reduce((sum, row) => sum + row.paidAmountCents, 0)} />
            <Metric label="Adjustments" count={data.claims.filter((row) => row.adjustmentAmountCents > 0).length} amount={data.claims.reduce((sum, row) => sum + row.adjustmentAmountCents, 0)} />
            <Metric label="Open Balance" count={data.claims.filter((row) => row.openBalanceCents > 0).length} amount={data.claims.reduce((sum, row) => sum + row.openBalanceCents, 0)} />
          </div>
        </section>
      )}

      {!loading && data && !["overview", "reports"].includes(tab) && (
        <>
          <section className="thera-card" style={{ marginBottom: 16 }}>
            <div className="thera-filter-row">
              <input className="thera-input" placeholder="Search claim, patient, payer..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="thera-input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Array.from(new Set(data.claims.map((row) => String(row.claim_status)))).sort().map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
              <select className="thera-input" value={payer} onChange={(e) => setPayer(e.target.value)}><option value="">All payers</option>{data.payers.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Payer")}</option>)}</select>
              <select className="thera-input" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">All providers</option>{data.providers.map((row) => <option key={row.id} value={row.id}>{[row.first_name, row.last_name].filter(Boolean).join(" ")}</option>)}</select>
              <input className="thera-input" placeholder="CPT" value={cpt} onChange={(e) => setCpt(e.target.value)} />
              <input className="thera-input" placeholder="Diagnosis" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
              <select className="thera-input" value={sort} onChange={(e) => setSort(e.target.value as "dos_desc" | "balance_desc")}><option value="dos_desc">Newest DOS</option><option value="balance_desc">Highest Balance</option></select>
            </div>
            {selected.size > 0 && <div className="thera-filter-row" style={{ marginTop: 12 }}><strong>{selected.size} selected</strong><button className="thera-action secondary" type="button" disabled={saving} onClick={() => void runBulk("validate")}>Validate</button><button className="thera-action secondary" type="button" disabled={saving} onClick={() => void runBulk("followup")}>Create Follow-Up</button>{tab === "rejections" && <button className="thera-action" type="button" disabled={saving} onClick={() => void runBulk("retry")}>Retry Rejected</button>}</div>}
          </section>

          <ClaimsTable rows={visible} selected={selected} onToggle={toggle} />
          <div className="thera-filter-row" style={{ justifyContent: "space-between", marginTop: 12 }}><span>{filtered.length} claim(s) · Page {page} of {pageCount}</span><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" className="thera-action secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
        </>
      )}
    </>
  );
}

function Metric({ label, count, amount }: { label: string; count: number; amount?: number }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{count}</div>{amount !== undefined && <div className="thera-table-subtext">{money(amount)}</div>}</div>;
}

function ClaimsTable({ rows, selected, onToggle }: { rows: ClaimsWorkspaceRow[]; selected: Set<string>; onToggle: (id: string) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No claims match this workqueue.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th></th><th>Claim</th><th>Patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>CPT / Dx</th><th>Clearinghouse</th><th>Charge</th><th>Paid</th><th>Balance</th><th>Status</th><th>Exceptions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" checked={selected.has(row.id)} onChange={() => onToggle(row.id)} aria-label={`Select ${String(row.patient_control_number ?? row.id)}`} /></td><td><Link className="thera-table-link" href={`/claims/${row.id}`}>{String(row.patient_control_number ?? "Open Claim")}</Link><div className="thera-table-subtext">{String(row.payer_claim_number ?? "No payer claim #")}</div></td><td>{row.clientName}</td><td>{shortDate(String(row.service_date_from ?? ""))}</td><td>{row.payerName}</td><td>{row.providerName}</td><td>{row.cptCodes.join(", ") || "—"}<div className="thera-table-subtext">{row.diagnosisCodes.join(", ") || "—"}</div></td><td><StatusBadge value={row.clearinghouseStatus} /></td><td>{money(Number(row.total_charge_cents ?? 0))}</td><td>{money(row.paidAmountCents)}</td><td>{money(row.openBalanceCents)}</td><td><StatusBadge value={String(row.claim_status)} /></td><td>{row.denialCount > 0 ? `${row.denialCount} denial` : row.workCount > 0 ? `${row.workCount} work item` : "—"}</td></tr>)}</tbody></table></div></section>;
}
