import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getClaimWorkData, type ClaimWorkData } from "./workspace-repository";
import type { ClaimWorkSection } from "./claim-work-drawer.types";

export type ClaimWorkRecord = {
  id: string;
  patientControlNumber?: string | null;
  payerClaimNumber?: string | null;
  claimStatus: string;
  serviceDateFrom?: string | null;
  totalChargeCents?: number;
  clientName: string;
  payerName?: string | null;
  renderingProviderName?: string | null;
};

type Props = {
  claim: ClaimWorkRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
};

const sections: Array<[ClaimWorkSection, string]> = [
  ["fields", "Claim Fields"], ["lines", "Claim Lines"], ["diagnoses", "Diagnoses"], ["validation", "Validation Errors"],
  ["responses", "Clearinghouse Responses"], ["rejections", "Rejections"], ["denials", "Denials"], ["appeals", "Appeals"],
  ["work-items", "Work Items"], ["history", "Notes / History"],
];

function text(value: unknown, fallback = "—") { return value == null || value === "" ? fallback : String(value); }
function date(value: unknown) { return value ? shortDate(String(value)) : "—"; }
function amount(value: unknown) { return money(Number(value ?? 0)); }

export function ClaimWorkDrawer({ claim, open, onOpenChange, queuePosition, onPrevious, onNext, previousDisabled, nextDisabled }: Props) {
  const [, navigate] = useLocation();
  const [section, setSection] = useState<ClaimWorkSection>("fields");
  const [workData, setWorkData] = useState<ClaimWorkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !claim) return;
    let active = true;
    setLoading(true); setLoadError(null); setWorkData(null);
    void getClaimWorkData(claim.id).then((result) => { if (active) setWorkData(result); }).catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : "Unable to load claim work data."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [claim?.id, open]);

  if (!claim) return null;
  const record = workData?.claim;

  return <WorkDrawer open={open} onOpenChange={onOpenChange} title={claim.clientName}
    subtitle={`${claim.patientControlNumber || "Claim"} · ${claim.payerName || "No payer"} · DOS ${shortDate(claim.serviceDateFrom)}`}
    badges={<StatusBadge value={claim.claimStatus} />} queuePosition={queuePosition} onPrevious={onPrevious} onNext={onNext}
    previousDisabled={previousDisabled} nextDisabled={nextDisabled} openFullRecord={() => navigate(`/claims/${claim.id}`)} openFullRecordLabel="Open Full Claim 360"
    footer={<div className="thera-filter-row"><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Close</button></div>}>
    <section className="thera-card" style={{ marginBottom: "1rem" }}><div className="thera-filter-row"><strong>Claim:</strong> {claim.patientControlNumber || "No control number"}<strong>Payer claim #:</strong> {claim.payerClaimNumber || "Not assigned"}<strong>Rendering:</strong> {claim.renderingProviderName || "Not assigned"}<strong>Charge:</strong> {money(claim.totalChargeCents)}</div></section>
    <div className="thera-filter-row" role="tablist" aria-label="Claim work sections" style={{ marginBottom: "1rem" }}>{sections.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={`thera-action ${section === key ? "" : "secondary"}`} onClick={() => setSection(key)}>{label}</button>)}</div>
    {loading && <div className="thera-state">Loading claim work record...</div>}
    {loadError && <div className="thera-state error">{loadError}</div>}
    {!loading && !loadError && <section className="thera-card"><h2>{sections.find(([key]) => key === section)?.[1]}</h2><Section section={section} data={workData} record={record} /></section>}
  </WorkDrawer>;
}

function Section({ section, data, record }: { section: ClaimWorkSection; data: ClaimWorkData | null; record?: Record<string, unknown> }) {
  if (!data || !record) return <div className="thera-state">Claim record unavailable.</div>;
  if (section === "fields") return <div className="thera-detail-grid"><Detail label="Patient control #" value={record.patient_control_number} /><Detail label="Payer claim #" value={record.payer_claim_number} /><Detail label="DOS from" value={date(record.service_date_from)} /><Detail label="DOS through" value={date(record.service_date_to)} /><Detail label="Place of service" value={record.place_of_service_code} /><Detail label="Frequency" value={record.claim_frequency_code} /><Detail label="Total charge" value={amount(record.total_charge_cents)} /><Detail label="Status" value={text(record.claim_status)} /></div>;
  if (section === "lines") return <Rows rows={data.lines} empty="No claim lines recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.cpt_code, "Procedure")}</strong><div className="thera-table-subtext">DOS {date(row.service_date)} · {text(row.units, "1")} unit(s) · {amount(row.charge_cents)}</div>{row.modifier_1 ? <div>Modifier: {text(row.modifier_1)}</div> : null}</div>} />;
  if (section === "diagnoses") return <Rows rows={data.diagnoses} empty="No diagnoses recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.diagnosis_code)}</strong><div className="thera-table-subtext">Pointer order {text(row.pointer_order)}</div></div>} />;
  if (section === "responses" || section === "rejections") { const rows = section === "rejections" ? data.responses.filter((r) => String(r.response_status ?? "").toLowerCase().includes("reject")) : data.responses; return <Rows rows={rows} empty={section === "rejections" ? "No post-submission rejections recorded." : "No clearinghouse responses recorded."} render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.response_status)} /><div><strong>{text(row.response_code, "Response")}</strong> {text(row.response_message, "")}</div><div className="thera-table-subtext">{date(row.created_at)}</div></div>} />; }
  if (section === "validation") return <div className="thera-state">Validation results will appear here as pre-submission validation findings. They are not classified as Action Required.</div>;
  if (section === "denials") return <Rows rows={data.denials} empty="No denials recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.denial_category, "Denial")}</strong><div>{text(row.denial_reason, text(row.reason, "No reason recorded"))}</div><div className="thera-table-subtext">CARC {text(row.carc_code)} · RARC {text(row.rarc_code)} · Denied {amount(row.denied_amount_cents)}</div></div>} />;
  if (section === "appeals") return <Rows rows={data.appeals} empty="No appeals recorded." render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.appeal_status)} /><div>{text(row.appeal_level, "Appeal")}</div><div className="thera-table-subtext">Submitted {date(row.submitted_at)} · Deadline {date(row.deadline_date)}</div></div>} />;
  if (section === "work-items") return <Rows rows={data.workItems} empty="No claim work items recorded." render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.workqueue_status)} /><strong>{text(row.title, "Claim work item")}</strong><div>{text(row.description, "")}</div></div>} />;
  return <Rows rows={data.history} empty="No claim history recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.old_status)} → {text(row.new_status)}</strong><div>{text(row.reason, "")}</div><div className="thera-table-subtext">{date(row.created_at)}</div></div>} />;
}

function Detail({ label, value }: { label: string; value: unknown }) { return <div><div className="thera-table-subtext">{label}</div><strong>{text(value)}</strong></div>; }
function Rows({ rows, empty, render }: { rows: Array<Record<string, unknown> & { id: string }>; empty: string; render: (row: Record<string, unknown> & { id: string }) => React.ReactNode }) { if (!rows.length) return <div className="thera-state">{empty}</div>; return <div style={{ display: "grid", gap: 10 }}>{rows.map(render)}</div>; }
