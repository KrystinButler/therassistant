import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { PayerIntelligencePanel } from "../../components/payer-intelligence-panel";
import { money, shortDate } from "../../lib/format";
import { getClaimErrorGuidance, type ClaimCorrectionTarget } from "./claim-error-guidance";
import { getClaimWorkReferenceData, saveClaimIdentityFields, type ClaimIdentityValues } from "./claim-work-identity";
import { getClaimWorkData, saveClaimWorkFields, type ClaimWorkData, type ClaimWorkFieldValues } from "./workspace-repository";
import type { ClaimWorkSection } from "./claim-work-drawer.types";

export type ClaimWorkRecord = {
  id: string;
  patientControlNumber?: string | null;
  payerClaimNumber?: string | null;
  claimStatus: string;
  serviceDateFrom?: string | null;
  totalChargeCents?: number;
  paidAmountCents?: number;
  openBalanceCents?: number;
  submittedAt?: string | null;
  clearinghouseStatus?: string | null;
  clientName: string;
  payerName?: string | null;
  renderingProviderName?: string | null;
};
type Props = {
  claim: ClaimWorkRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "edit" | "follow_up";
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
};
type DrawerForm = ClaimWorkFieldValues & ClaimIdentityValues;
type ReferenceData = Awaited<ReturnType<typeof getClaimWorkReferenceData>>;
const editSections: Array<[ClaimWorkSection, string]> = [["fields", "Claim Fields"], ["lines", "Claim Lines"], ["diagnoses", "Diagnoses"], ["validation", "Validation Errors"], ["responses", "Clearinghouse Responses"], ["rejections", "Rejections"], ["denials", "Denials"], ["appeals", "Appeals"], ["work-items", "Work Items"], ["history", "Notes / History"]];
const followUpSections: Array<[ClaimWorkSection, string]> = [["responses", "Payer / Clearinghouse"], ["work-items", "Follow-Up"], ["denials", "Denials"], ["appeals", "Appeals"], ["history", "Notes / History"]];
function text(value: unknown, fallback = "—") { return value == null || value === "" ? fallback : String(value); }
function date(value: unknown) { return value ? shortDate(String(value)) : "—"; }
function amount(value: unknown) { return money(Number(value ?? 0)); }
function personName(row: Record<string, unknown>) { return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed"; }
function formFrom(record?: Record<string, unknown>): DrawerForm { return { client_id: text(record?.client_id, ""), payer_id: text(record?.payer_id, ""), rendering_provider_id: text(record?.rendering_provider_id, ""), patient_control_number: text(record?.patient_control_number, ""), payer_claim_number: text(record?.payer_claim_number, ""), service_date_from: text(record?.service_date_from, "").slice(0, 10), service_date_to: text(record?.service_date_to, "").slice(0, 10), place_of_service_code: text(record?.place_of_service_code, ""), claim_frequency_code: text(record?.claim_frequency_code, ""), total_charge_cents: Number(record?.total_charge_cents ?? 0) }; }
function targetSection(target: ClaimCorrectionTarget): ClaimWorkSection { if (target === "claim_lines") return "lines"; if (target === "diagnoses") return "diagnoses"; return "fields"; }

export function ClaimWorkDrawer({ claim, open, onOpenChange, mode = "edit", queuePosition, onPrevious, onNext, previousDisabled, nextDisabled }: Props) {
  const [, navigate] = useLocation();
  const [section, setSection] = useState<ClaimWorkSection>(mode === "follow_up" ? "responses" : "fields");
  const [workData, setWorkData] = useState<ClaimWorkData | null>(null);
  const [refs, setRefs] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<DrawerForm>(formFrom());
  const [baseline, setBaseline] = useState<DrawerForm>(formFrom());
  const dirty = mode === "edit" && JSON.stringify(form) !== JSON.stringify(baseline);
  const sections = mode === "follow_up" ? followUpSections : editSections;

  useEffect(() => {
    if (!open || !claim) return;
    let active = true;
    setSection(mode === "follow_up" ? "responses" : "fields");
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    const referencePromise = mode === "edit" ? getClaimWorkReferenceData() : Promise.resolve(null);
    void Promise.all([getClaimWorkData(claim.id), referencePromise]).then(([result, referenceData]) => {
      if (!active) return;
      setWorkData(result);
      setRefs(referenceData);
      const next = formFrom(result?.claim);
      setForm(next);
      setBaseline(next);
    }).catch((err) => {
      if (active) setLoadError(err instanceof Error ? err.message : "Unable to load claim work data.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [claim?.id, open, mode]);

  if (!claim) return null;
  const activeClaim = claim;
  async function reload() { const result = await getClaimWorkData(activeClaim.id); setWorkData(result); const next = formFrom(result?.claim); setForm(next); setBaseline(next); }
  async function save(revalidate: boolean, continueQueue = false) { setSaving(true); setLoadError(null); setMessage(null); try { await saveClaimIdentityFields(activeClaim.id, form); const result = await saveClaimWorkFields(activeClaim.id, form, revalidate); await reload(); const blocked = revalidate && "ok" in result && result.ok === false && result.blocked; if (blocked) { setSection("validation"); setMessage("Claim saved. Validation found corrections that still need attention."); } else { setMessage(revalidate ? "Claim saved and revalidated." : "Claim saved."); if (continueQueue && onNext && !nextDisabled) onNext(); } } catch (err) { setLoadError(err instanceof Error ? err.message : "Unable to save claim."); } finally { setSaving(false); } }
  function move(direction: "previous" | "next") { if (dirty && !window.confirm("Discard unsaved changes and move to another claim?")) return; direction === "previous" ? onPrevious?.() : onNext?.(); }
  function correct(target: ClaimCorrectionTarget) { const nextSection = targetSection(target); setSection(nextSection); if (nextSection !== "fields") return; window.setTimeout(() => { const container = document.querySelector<HTMLElement>(`[data-claim-field="${target}"]`); const control = container?.querySelector<HTMLElement>("input, select, textarea, button"); container?.scrollIntoView({ behavior: "smooth", block: "center" }); control?.focus(); }, 0); }
  const editFooter = <div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={saving || !dirty} onClick={() => void save(false)}>Save</button><button type="button" className="thera-action secondary" disabled={saving} onClick={() => void save(true)}>Save & Revalidate</button><button type="button" className="thera-action" disabled={saving || nextDisabled} onClick={() => void save(false, true)}>Save & Continue</button></div></div>;
  const followUpFooter = <div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Close</button>{onNext && !nextDisabled ? <button type="button" className="thera-action" onClick={() => onNext()}>Next Claim</button> : null}</div>;

  return <WorkDrawer open={open} onOpenChange={onOpenChange} dirty={dirty} title={activeClaim.clientName} subtitle={`${activeClaim.patientControlNumber || "Claim"} · ${activeClaim.payerName || "No payer"} · DOS ${shortDate(activeClaim.serviceDateFrom)}`} badges={<StatusBadge value={activeClaim.claimStatus} />} queuePosition={queuePosition} onPrevious={() => move("previous")} onNext={() => move("next")} previousDisabled={previousDisabled} nextDisabled={nextDisabled} openFullRecord={() => navigate(`/claims/${activeClaim.id}`)} openFullRecordLabel="Open Full Claim 360" footer={mode === "follow_up" ? followUpFooter : editFooter}>
    {mode === "follow_up" ? <section className="thera-card" style={{ marginBottom: "1rem" }}><h2>Payer follow-up</h2><div className="thera-form-grid"><div><div className="thera-table-subtext">Claim</div><strong>{activeClaim.patientControlNumber || "No control number"}</strong></div><div><div className="thera-table-subtext">Payer claim #</div><strong>{activeClaim.payerClaimNumber || "Not assigned"}</strong></div><div><div className="thera-table-subtext">Rendering provider</div><strong>{activeClaim.renderingProviderName || "Not assigned"}</strong></div><div><div className="thera-table-subtext">Submitted</div><strong>{activeClaim.submittedAt ? shortDate(activeClaim.submittedAt) : "—"}</strong></div><div><div className="thera-table-subtext">Charge</div><strong>{money(activeClaim.totalChargeCents)}</strong></div><div><div className="thera-table-subtext">Paid</div><strong>{money(activeClaim.paidAmountCents)}</strong></div><div><div className="thera-table-subtext">Open balance</div><strong>{money(activeClaim.openBalanceCents)}</strong></div><div><div className="thera-table-subtext">Latest payer / clearinghouse response</div><strong>{activeClaim.clearinghouseStatus || "No response"}</strong></div></div></section> : <section className="thera-card" style={{ marginBottom: "1rem" }}><div className="thera-filter-row"><strong>Claim:</strong> {activeClaim.patientControlNumber || "No control number"}<strong>Payer claim #:</strong> {activeClaim.payerClaimNumber || "Not assigned"}<strong>Rendering:</strong> {activeClaim.renderingProviderName || "Not assigned"}<strong>Charge:</strong> {money(activeClaim.totalChargeCents)}</div></section>}
    {mode === "follow_up" && workData?.claim.payer_id ? <div style={{ marginBottom: "1rem" }}><PayerIntelligencePanel payerId={String(workData.claim.payer_id)} context="follow_up" claimId={activeClaim.id} title="Payer Follow-Up Instructions" /></div> : null}
    <div className="thera-filter-row" role="tablist" aria-label={mode === "follow_up" ? "Payer follow-up sections" : "Claim work sections"} style={{ marginBottom: "1rem" }}>{sections.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={`thera-action ${section === key ? "" : "secondary"}`} onClick={() => setSection(key)}>{label}</button>)}</div>
    {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}{loading && <div className="thera-state">Loading claim work record...</div>}{loadError && <div className="thera-state error">{loadError}</div>}
    {!loading && !loadError && <section className="thera-card"><h2>{sections.find(([key]) => key === section)?.[1]}</h2>{mode === "edit" && section === "fields" ? <ClaimFields form={form} setForm={setForm} status={workData?.claim.claim_status} refs={refs} /> : <Section section={section} data={workData} onCorrect={correct} />}</section>}
  </WorkDrawer>;
}

function ClaimFields({ form, setForm, status, refs }: { form: DrawerForm; setForm: (updater: (current: DrawerForm) => DrawerForm) => void; status: unknown; refs: ReferenceData | null }) { function field(key: keyof DrawerForm, value: string | number) { setForm((current) => ({ ...current, [key]: value })); } return <div className="thera-form-grid"><label data-claim-field="patient">Patient<select className="thera-input" value={form.client_id} onChange={(e) => field("client_id", e.target.value)}><option value="">Select patient</option>{(refs?.clients ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}</option>)}</select></label><label data-claim-field="payer">Payer<select className="thera-input" value={form.payer_id} onChange={(e) => field("payer_id", e.target.value)}><option value="">Select payer</option>{(refs?.payers ?? []).map((row) => <option key={row.id} value={row.id}>{text(row.name, "Payer")}</option>)}</select></label><label data-claim-field="rendering_provider">Rendering provider<select className="thera-input" value={form.rendering_provider_id} onChange={(e) => field("rendering_provider_id", e.target.value)}><option value="">Select provider</option>{(refs?.providers ?? []).map((row) => <option key={row.id} value={row.id}>{personName(row)}{row.credentials ? `, ${String(row.credentials)}` : ""}</option>)}</select></label><label data-claim-field="patient_control_number">Patient control #<input className="thera-input" value={form.patient_control_number} onChange={(e) => field("patient_control_number", e.target.value)} /></label><label data-claim-field="payer_claim_number">Payer claim #<input className="thera-input" value={form.payer_claim_number} onChange={(e) => field("payer_claim_number", e.target.value)} /></label><label data-claim-field="service_date_from">DOS from<input className="thera-input" type="date" value={form.service_date_from} onChange={(e) => field("service_date_from", e.target.value)} /></label><label data-claim-field="service_date_to">DOS through<input className="thera-input" type="date" value={form.service_date_to} onChange={(e) => field("service_date_to", e.target.value)} /></label><label data-claim-field="place_of_service_code">Place of service<input className="thera-input" value={form.place_of_service_code} onChange={(e) => field("place_of_service_code", e.target.value)} /></label><label data-claim-field="claim_frequency_code">Claim frequency<input className="thera-input" value={form.claim_frequency_code} onChange={(e) => field("claim_frequency_code", e.target.value)} /></label><label data-claim-field="total_charge_cents">Total charge<input className="thera-input" type="number" min="0" step="0.01" value={(form.total_charge_cents / 100).toFixed(2)} onChange={(e) => field("total_charge_cents", Math.round(Number(e.target.value || 0) * 100))} /></label><div><div className="thera-table-subtext">Current status</div><StatusBadge value={text(status)} /></div></div>; }
function Guidance({ message, onCorrect }: { message: string; onCorrect: (target: ClaimCorrectionTarget) => void }) { const guidance = getClaimErrorGuidance(message); if (!guidance) return <div>{message}</div>; return <div style={{ display: "grid", gap: 8 }}><div><strong>What is wrong:</strong> {guidance.whatIsWrong}</div><div><strong>Why it matters:</strong> {guidance.whyItMatters}</div><div><strong>What to correct:</strong> {guidance.correction}</div><div><button type="button" className="thera-action secondary" onClick={() => onCorrect(guidance.target)}>{guidance.actionLabel}</button></div></div>; }
function validationMessages(value: unknown) { const raw = text(value, ""); return raw.split(/(?<=\.)\s+/).map((item) => item.trim()).filter(Boolean); }
function Section({ section, data, onCorrect }: { section: ClaimWorkSection; data: ClaimWorkData | null; onCorrect: (target: ClaimCorrectionTarget) => void }) { if (!data) return <div className="thera-state">Claim record unavailable.</div>; if (section === "lines") return <Rows rows={data.lines} empty="No claim lines recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.cpt_code, "Procedure")}</strong><div className="thera-table-subtext">DOS {date(row.service_date)} · {text(row.units, "1")} unit(s) · {amount(row.charge_amount_cents ?? row.charge_cents)}</div>{row.modifier1 || row.modifier_1 ? <div>Modifier: {text(row.modifier1 ?? row.modifier_1)}</div> : null}</div>} />; if (section === "diagnoses") return <Rows rows={data.diagnoses} empty="No diagnoses recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.diagnosis_code)}</strong><div className="thera-table-subtext">Pointer order {text(row.pointer_order)}</div></div>} />; if (section === "responses" || section === "rejections") { const rows = section === "rejections" ? data.responses.filter((r) => String(r.response_status ?? "").toLowerCase().includes("reject")) : data.responses; return <Rows rows={rows} empty={section === "rejections" ? "No post-submission rejections recorded." : "No clearinghouse responses recorded."} render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.response_status)} /><div><strong>{text(row.response_code, "Response")}</strong></div>{section === "rejections" ? <Guidance message={text(row.response_message, "Clearinghouse rejected the claim for correction.")} onCorrect={onCorrect} /> : <div>{text(row.response_message, "")}</div>}<div className="thera-table-subtext">{date(row.created_at)}</div></div>} />; } if (section === "validation") { const rows = data.workItems.filter((row) => row.workqueue_type === "claim_validation" && row.workqueue_status !== "completed"); return <Rows rows={rows} empty="No current pre-submission validation findings." render={(row) => <div className="thera-card" key={row.id}><strong>Validation finding</strong><div className="thera-table-subtext" style={{ marginBottom: 8 }}>Pre-submission validation · not Action Required</div><div style={{ display: "grid", gap: 12 }}>{validationMessages(row.description).map((item) => <Guidance key={item} message={item} onCorrect={onCorrect} />)}</div></div>} />; } if (section === "denials") return <Rows rows={data.denials} empty="No denials recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.denial_category, "Denial")}</strong><div>{text(row.denial_reason, text(row.reason, "No reason recorded"))}</div><div className="thera-table-subtext">CARC {text(row.carc_code)} · RARC {text(row.rarc_code)} · Denied {amount(row.denied_amount_cents ?? row.amount_cents)}</div></div>} />; if (section === "appeals") return <Rows rows={data.appeals} empty="No appeals recorded." render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.appeal_status)} /><div>{text(row.appeal_level, "Appeal")}</div><div className="thera-table-subtext">Submitted {date(row.submitted_at)} · Deadline {date(row.deadline_date)}</div></div>} />; if (section === "work-items") return <Rows rows={data.workItems} empty="No claim work items recorded." render={(row) => <div className="thera-card" key={row.id}><StatusBadge value={text(row.workqueue_status)} /><strong>{text(row.title, "Claim work item")}</strong><div>{text(row.description, "")}</div>{row.due_date ? <div className="thera-table-subtext">Due {date(row.due_date)}</div> : null}</div>} />; return <Rows rows={data.history} empty="No claim history recorded." render={(row) => <div className="thera-card" key={row.id}><strong>{text(row.old_status)} to {text(row.new_status)}</strong><div>{text(row.reason, "")}</div><div className="thera-table-subtext">{date(row.created_at)}</div></div>} />; }
function Rows({ rows, empty, render }: { rows: Array<Record<string, unknown> & { id: string }>; empty: string; render: (row: Record<string, unknown> & { id: string }) => React.ReactNode }) { if (!rows.length) return <div className="thera-state">{empty}</div>; return <div style={{ display: "grid", gap: 10 }}>{rows.map(render)}</div>; }
