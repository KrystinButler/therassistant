import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { money, shortDate } from "../../lib/format";

type Charge = Record<string, any>;
type Encounter = Record<string, any> & {
  clientName: string;
  providerName: string;
  payerName: string;
  blockingChecks: Array<Record<string, unknown> & { id: string }>;
};

export function ChargeWorkDrawer({ open, encounter, charges, saving, onOpenChange, onRunAudit, onCreateCharge, onCreateClaim }: { open: boolean; encounter: Encounter | null; charges: Charge[]; saving: boolean; onOpenChange: (open: boolean) => void; onRunAudit: () => void; onCreateCharge: () => void; onCreateClaim: () => void }) {
  const blockingIssues = encounter?.blockingChecks ?? [];
  const readyCharges = charges.filter((charge) => charge.charge_status === "ready_for_claim");
  const total = charges.reduce((sum, charge) => sum + Number(charge.charge_amount_cents ?? 0), 0);
  return <WorkDrawer open={open} onOpenChange={onOpenChange} title={encounter?.clientName || "Charge Work"} subtitle={[encounter?.providerName, encounter?.payerName].filter(Boolean).join(" · ") || "Billing Readiness"} badges={encounter ? <StatusBadge value={String(encounter.billing_status ?? "not_ready")} /> : undefined} openFullRecord={encounter ? () => { window.location.href = `/encounters/${encounter.id}`; } : undefined} openFullRecordLabel="Open Encounter" footer={encounter ? <div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={saving} onClick={onRunAudit}>Run Audit</button>{encounter.billing_status === "ready" && charges.length === 0 ? <button type="button" className="thera-action" disabled={saving} onClick={onCreateCharge}>Create Charge</button> : null}{readyCharges.length > 0 ? <button type="button" className="thera-action" disabled={saving} onClick={onCreateClaim}>Create Claim</button> : null}</div> : undefined}>
    {!encounter ? <div className="thera-state">Select billing work to review.</div> : <div className="thera-stack"><section className="thera-card"><div className="thera-card-header"><div><h2>Billing Readiness</h2><p>Review the encounter before moving revenue-cycle work forward.</p></div></div><div className="thera-metric-grid"><div className="thera-metric-card"><div className="thera-metric-label">Patient</div><div className="thera-metric-value small">{encounter.clientName || "—"}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Provider</div><div className="thera-metric-value small">{encounter.providerName || "—"}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Payer</div><div className="thera-metric-value small">{encounter.payerName || "—"}</div></div><div className="thera-metric-card"><div className="thera-metric-label">DOS</div><div className="thera-metric-value small">{shortDate(String(encounter.started_at ?? ""))}</div></div></div></section>
    <section className="thera-card"><div className="thera-card-header"><h2>Blocking Issues</h2></div>{blockingIssues.length ? blockingIssues.map((check) => <div className="thera-alert" key={check.id}>{String(check.message ?? "Billing requirement needs correction.")}</div>) : <div className="thera-state">No blocking issues are currently identified.</div>}</section>
    <section className="thera-card"><div className="thera-card-header"><div><h2>Charges</h2><p>{charges.length} charge line(s) · {money(total)}</p></div></div>{charges.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Service</th><th>Amount</th><th>Status</th></tr></thead><tbody>{charges.map((charge) => <tr key={charge.id}><td>{String(charge.cpt_code ?? "—")}<div className="thera-table-subtext">Dx {String(charge.diagnosis_code ?? "—")}</div></td><td>{money(Number(charge.charge_amount_cents ?? 0))}</td><td><StatusBadge value={String(charge.charge_status ?? "captured")} /></td></tr>)}</tbody></table></div> : <div className="thera-state">No charge has been created for this encounter.</div>}<div style={{ marginTop: 12 }}><Link className="thera-link" href={`/encounters/${encounter.id}`}>Open Encounter</Link></div></section></div>}
  </WorkDrawer>;
}
