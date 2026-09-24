import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../../components/status-badge";
import { referenceSelect, tenantSelect } from "../../lib/tenant-data-client";
import { shortDate } from "../../lib/format";
import {
  COLORADO_RAE_REGIONS, COLORADO_RAE_SOURCE, REFERENCE_REVIEWED, REFERENCE_DUE,
  getColoradoPayerProfile, getColoradoReferenceResources, coloradoPayerScope, coloradoPayerRouting,
} from "./colorado-payer-reference";

type Row = Record<string, any>;
type Filter = "all" | "rae" | "public" | "commercial";
const validSource = (url: unknown) => typeof url === "string" && /^https:\/\//i.test(url);

export function PayersContractsPage() {
  const [payers, setPayers] = useState<Row[]>([]);
  const [contracts, setContracts] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Row[]>([]);
  const [enrollments, setEnrollments] = useState<Row[]>([]);
  const [resources, setResources] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      referenceSelect<Row>("payers", { order: "name.asc" }),
      tenantSelect<Row>("payer_contracts"),
      referenceSelect<Row>("payer_plans"),
      tenantSelect<Row>("provider_payer_enrollments"),
      tenantSelect<Row>("payer_resources"),
    ]).then(([p, c, pl, e, r]) => {
      if (!active) return;
      setPayers(p); setContracts(c); setPlans(pl); setEnrollments(e); setResources(r);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load Colorado payer library.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const current = (r: Row) => r.verification_status === "verified" &&
    (!r.review_due_at || String(r.review_due_at).slice(0, 10) >= today);
  const rows = useMemo(() => payers.map((payer) => ({
    payer,
    profile: getColoradoPayerProfile(String(payer.name ?? "")),
    contracts: contracts.filter((r) => r.payer_id === payer.id),
    plans: plans.filter((r) => r.payer_id === payer.id),
    enrollments: enrollments.filter((r) => r.payer_id === payer.id),
    resources: resources.filter((r) => r.payer_id === payer.id),
  })).filter(({ payer, profile }) => {
    const search = query.trim().toLowerCase();
    if (search && ![payer.name, coloradoPayerScope(profile)].some((v) => String(v ?? "").toLowerCase().includes(search))) return false;
    if (filter === "rae") return profile?.category === "rae";
    if (filter === "public") return ["state", "mco", "medicare", "military"].includes(profile?.category ?? "");
    if (filter === "commercial") return profile?.category === "commercial";
    return true;
  }), [payers, contracts, plans, enrollments, resources, query, filter]);

  return <>
    <div className="thera-page-header split">
      <div>
        <div className="thera-eyebrow">COLORADO · PRELOADED PAYER REFERENCE</div>
        <h1>Payers & Contracts</h1>
        <p>Colorado payer profiles, current official sources and regional routing guidance are already available. Practice-specific contracts, fee schedules and provider participation remain evidence-based.</p>
      </div>
      <Link href="/credentialing" className="thera-action secondary">Credentialing</Link>
    </div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    <section className="thera-card" style={{ marginBottom: 14, borderLeft: "4px solid var(--thera-sage)" }}>
      <div className="thera-card-header split">
        <div>
          <div className="thera-eyebrow">ACCOUNTABLE CARE COLLABORATIVE · PHASE III</div>
          <h2>Four Colorado Regional Organizations</h2>
          <p>Reference effective July 1, 2025. The member's assigned RAE, product and covered benefit determine the actual claim destination.</p>
        </div>
        <a className="thera-action secondary" href={COLORADO_RAE_SOURCE} target="_blank" rel="noreferrer">Official State Reference ↗</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 9 }}>
        {COLORADO_RAE_REGIONS.map((r) => <div key={r.region} style={{ background: "var(--thera-cream)", border: "1px solid var(--thera-border)", borderRadius: 8, padding: 11 }}>
          <div className="thera-eyebrow">REGION {r.region}</div>
          <strong style={{ color: "var(--thera-navy)", fontSize: ".81rem" }}>{r.name}</strong>
        </div>)}
      </div>
    </section>
    {!loading && <div className="thera-metric-grid" style={{ marginBottom: 14 }}>
      <div className="thera-metric-card"><div className="thera-metric-label">Colorado Payer Profiles</div><div className="thera-metric-value">{payers.length}</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">State RAE Regions</div><div className="thera-metric-value">4</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">Current Verified Sources</div><div className="thera-metric-value">{resources.filter(current).length}</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">Active Practice Contracts</div><div className="thera-metric-value">{contracts.filter((r) => r.status === "active").length}</div></div>
    </div>}
    <section className="thera-card">
      <div className="thera-card-header split">
        <div><h2>Colorado Payer Library</h2><p>No payer-reference setup required. Source dates show when to review published guidance; contracts and reimbursement rates are not pre-assumed.</p></div>
        <div className="thera-filter-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="thera-field-label" htmlFor="payer-library-search">Search</label>
          <input id="payer-library-search" className="thera-input" placeholder="Payer or region" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 166 }} />
          <select className="thera-input" aria-label="Payer category" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All Payers</option>
            <option value="rae">Medicaid RAEs</option>
            <option value="public">Medicaid / Medicare / TRICARE</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
      </div>
      {loading && <div className="thera-state">Loading payer references...</div>}
      {!loading && !rows.length && <div className="thera-empty">No matching payer profiles.</div>}
      {!loading && rows.length > 0 && <div className="thera-table-wrap"><table className="thera-table">
        <thead><tr><th>Payer</th><th>Colorado Scope</th><th>Plans</th><th>Approved Providers</th><th>Verified Sources</th><th>EDI Payer ID</th><th>Practice Contract</th><th>Reference</th></tr></thead>
        <tbody>{rows.map(({ payer, profile, contracts: ownContracts, plans: ownPlans, enrollments: ownEnrollments, resources: ownResources }) => {
          const open = expanded === payer.id;
          const currentResources = ownResources.filter(current);
          const active = ownContracts.find((r) => r.status === "active") ?? ownContracts[0];
          const bundled = getColoradoReferenceResources(String(payer.id), String(payer.name));
          return <Fragment key={payer.id}>
            <tr>
              <td><Link className="thera-table-link" href={"/payers/" + payer.id}>{payer.name}</Link></td>
              <td><strong>{coloradoPayerScope(profile)}</strong></td>
              <td>{ownPlans.length}</td>
              <td>{ownEnrollments.filter((r) => r.enrollment_status === "approved").length}</td>
              <td>{currentResources.length}{!currentResources.length && <div className="thera-table-subtext">Preloaded source available</div>}</td>
              <td>{payer.clearinghouse_payer_id || <span className="thera-table-subtext">Not independently verified</span>}</td>
              <td>{active ? <><StatusBadge value={String(active.status)} /><div className="thera-table-subtext">{active.contract_name} · {shortDate(active.effective_date)}</div></> : <span className="thera-table-subtext">No executed contract on file</span>}</td>
              <td><button className={open ? "thera-action" : "thera-action secondary"} type="button" aria-expanded={open} aria-controls={"payer-reference-" + payer.id} onClick={() => setExpanded(open ? null : String(payer.id))}>{open ? "Hide" : "View"} Sources</button></td>
            </tr>
            {open && <tr><td id={"payer-reference-" + payer.id} colSpan={8} style={{ background: "var(--thera-cream)", padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
                <div>
                  <div className="thera-eyebrow">PUBLISHED REFERENCE</div>
                  <p style={{ margin: "6px 0", fontSize: ".78rem" }}>{coloradoPayerRouting(profile)}</p>
                  {profile?.note && <p style={{ fontSize: ".74rem" }}>{profile.note}</p>}
                  {profile?.url && <a href={profile.url} target="_blank" rel="noreferrer" className="thera-action secondary">Open Official Provider Source ↗</a>}
                  <div className="thera-table-subtext" style={{ marginTop: 9 }}>Reference checked {shortDate(REFERENCE_REVIEWED)} · Review again {shortDate(REFERENCE_DUE)}</div>
                  <div className="thera-table-subtext" style={{ marginTop: 5 }}>Published reference is not proof of a practice's network participation, negotiated rate or clearinghouse-specific ID.</div>
                </div>
                <div>
                  <div className="thera-eyebrow">CURRENT SAVED SOURCES</div>
                  {ownResources.length ? ownResources.slice(0, 10).map((resource) => <div key={resource.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--thera-border)" }}>
                    <div className="thera-filter-row"><strong>{resource.label}</strong><StatusBadge value={String(resource.verification_status ?? "unverified")} /></div>
                    {resource.value && <div className="thera-table-subtext">{resource.value}</div>}
                    {validSource(resource.url) && <a className="thera-link" href={String(resource.url)} target="_blank" rel="noreferrer">Open Source ↗</a>}
                    <div className="thera-table-subtext">Reviewed {shortDate(resource.reviewed_at)} · Next review {shortDate(resource.review_due_at)}</div>
                  </div>) : <div className="thera-table-subtext" style={{ margin: "10px 0" }}>No additional payer-specific evidence yet; use the preloaded provider source.</div>}
                  {bundled.filter((r) => r.url !== profile?.url).map((r) => <a className="thera-link" key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8 }}>{r.label} ↗</a>)}
                </div>
              </div>
              <div className="thera-filter-row" style={{ flexWrap: "wrap", marginTop: 14 }}>
                <Link href={"/payers/" + payer.id} className="thera-action secondary">Open Payer 360 & Actual Contracts</Link>
                <Link href="/credentialing" className="thera-action secondary">Credentialing Workqueue</Link>
              </div>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </section>
  </>;
}
