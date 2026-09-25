import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import { getClientChartRelationships } from "../clients/repository";
import { billingCorrectionLink } from "../billing/billing-correction-links";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { InsurancePanel } from "../insurance/InsurancePanel";
import { JournalPanel } from "../journal/JournalPanel";
import { PortalAccessPanel } from "../portal/PortalAccessPanel";
import { TreatmentPlanPanel } from "../treatment-plans/TreatmentPlanPanel";
import { DemographicsPanel } from "./DemographicsPanel";
import { getPatientChart } from "./repository";
import type { PatientChart } from "./types";

type Relationships = Awaited<ReturnType<typeof getClientChartRelationships>>;
type Tab = "overview" | "care" | "coverage" | "revenue" | "documents" | "engagement" | "demographics";

const tabs: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["care", "Care"],
  ["coverage", "Coverage"],
  ["revenue", "Revenue Cycle"],
  ["documents", "Documents"],
  ["engagement", "Engagement"],
  ["demographics", "Demographics"],
];

export function PatientChartPage() {
  const [, params] = useRoute<{ id: string }>("/clients/:id");
  const patientId = params?.id ?? "";
  const [chart, setChart] = useState<PatientChart | null>(null);
  const [relationships, setRelationships] = useState<Relationships | null>(null);
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useState<Tab>(
    tabs.some(([key]) => key === requestedTab) ? requestedTab as Tab : "overview",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!patientId) return;
    setLoading(true); setError(null);
    try {
      const [nextChart, nextRelationships] = await Promise.all([
        getPatientChart(patientId),
        getClientChartRelationships(patientId),
      ]);
      setChart(nextChart); setRelationships(nextRelationships);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load Patient Chart."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [patientId]);

  if (loading) return <div className="thera-state">Loading Patient Chart...</div>;
  if (error || !chart) return <div className="thera-state error">{error || "Patient not found."}</div>;

  const patient = chart.patient;
  const name = [patient.preferred_name || patient.first_name, patient.last_name].filter(Boolean).join(" ") || "Patient";
  const linkedWork = relationships?.workItems ?? chart.workItems;
  const nextUpcoming = chart.appointments
    .filter((row) => new Date(String(row.starts_at ?? "")) >= new Date() && !["cancelled","no_show","completed"].includes(String(row.appointment_status ?? "")))
    .sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];

  return <>
    <div className="thera-breadcrumb"><Link className="thera-link" href="/clients">Patients</Link><span>/</span><span>{name}</span></div>
    <div className="thera-page-header split"><div><div className="thera-eyebrow">PATIENT CHART</div><h1>{name}</h1><p>{String(patient.email ?? "No email")} · {String(patient.phone ?? "No phone")} · DOB {shortDate(String(patient.date_of_birth ?? ""))}</p></div><div className="thera-header-badges"><StatusBadge value={String(patient.client_status ?? "active")} /><StatusBadge value={String(patient.registration_status ?? "not_started")} /></div></div>

    <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
      <Metric label="Primary Payer" value={chart.summary.primaryPayerName} />
      <Metric label="Next Visit" value={nextUpcoming ? shortDate(String(nextUpcoming.starts_at ?? "")) : "None"} />
      <Metric label="Open Balance" value={money(chart.openBalanceCents)} />
      <Metric label="Open Work" value={linkedWork.filter((row) => ["open","in_progress","pending","snoozed","reopened"].includes(String(row.workqueue_status ?? ""))).length} />
    </div>

    <div className="thera-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? "thera-tab active" : "thera-tab"} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "overview" && <Overview chart={chart} relationships={relationships} setTab={setTab} />}
    {tab === "care" && <>
      <Appointments chart={chart} />
      <Encounters rows={relationships?.encounters ?? chart.encounters} />
      <TreatmentPlanPanel chart={chart} onChanged={load} />
      <ClinicalNotes chart={chart} />
      <Diagnoses chart={chart} />
    </>}
    {tab === "coverage" && <InsurancePanel chart={chart} onChanged={load} />}
    {tab === "revenue" && <>
      <Charges chart={chart} />
      <Claims chart={chart} />
      <Payments chart={chart} />
      <DenialsAppeals chart={chart} />
      <WorkItems rows={linkedWork} />
    </>}
    {tab === "documents" && <DocumentsPanel chart={chart} onChanged={load} />}
    {tab === "engagement" && <>
      <JournalPanel chart={chart} onChanged={load} />
      <PortalCheckIn chart={chart} />
    </>}
    {tab === "demographics" && <DemographicsPanel chart={chart} onChanged={load} />}
  </>;
}

function Overview({ chart, relationships, setTab }: { chart: PatientChart; relationships: Relationships | null; setTab: (tab: Tab) => void }) {
  const next = chart.appointments.filter((row) => new Date(String(row.starts_at ?? "")) >= new Date() && !["cancelled","no_show","completed"].includes(String(row.appointment_status ?? ""))).sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  const activePlan = chart.treatmentPlans.find((row) => ["active","signed"].includes(String(row.status ?? "")));
  return <div className="thera-detail-grid">
    <section className="thera-card"><div className="thera-eyebrow">ENGAGE + PREPARE</div><h2>Patient Readiness</h2><div className="thera-definition-grid"><Field label="Registration" value={<StatusBadge value={chart.summary.registrationStatus} />} /><Field label="Primary Payer" value={chart.summary.primaryPayerName} /><Field label="Treatment Plan" value={activePlan ? <StatusBadge value={String(activePlan.status)} /> : "None active"} /><Field label="Check-Ins" value={chart.checkins.length} /></div><div className="thera-filter-row" style={{ marginTop: 14 }}><button className="thera-action secondary" type="button" onClick={() => setTab("coverage")}>Coverage</button><button className="thera-action secondary" type="button" onClick={() => setTab("engagement")}>Engagement</button></div></section>
    <section className="thera-card"><div className="thera-eyebrow">PREPARE</div><h2>Next Appointment</h2>{next ? <><strong>{dateTime(String(next.starts_at ?? ""))}</strong><p>{String(next.service_type ?? "Appointment")} · {String(next.providerName ?? "—")}</p><Link className="thera-action secondary" href={`/schedule/${next.id}`}>Open Pre-Session</Link></> : <div className="thera-empty">No upcoming appointment.</div>}</section>
    <section className="thera-card"><div className="thera-eyebrow">DOCUMENT → GET PAID</div><h2>Care-to-Claim Spine</h2><div className="thera-definition-grid"><Field label="Encounters" value={relationships?.encounters.length ?? chart.encounters.length} /><Field label="Signed Notes" value={chart.clinicalNotes.filter((row) => row.note_status === "signed" || row.note_status === "locked").length} /><Field label="Charges" value={chart.charges.length} /><Field label="Claims" value={chart.claims.length} /></div><div className="thera-filter-row" style={{ marginTop: 14 }}><button className="thera-action secondary" type="button" onClick={() => setTab("care")}>Care</button><button className="thera-action secondary" type="button" onClick={() => setTab("revenue")}>Revenue Cycle</button></div></section>
    <section className="thera-card"><div className="thera-eyebrow">GET PAID</div><h2>Financial / Follow-Up</h2><div className="thera-definition-grid"><Field label="Open Balance" value={money(chart.openBalanceCents)} /><Field label="Payments" value={chart.payments.length} /><Field label="Denials" value={chart.denials.length} /><Field label="Appeals" value={chart.appeals.length} /></div></section>
  </div>;
}

function Appointments({ chart }: { chart: PatientChart }) { return <Table title="Appointments" rows={chart.appointments} columns={[["Date / Time","starts_at","datetime"],["Provider","providerName"],["Service","service_type"],["Location","location_type"],["Status","appointment_status","status"]]} action={(row) => <Link className="thera-action secondary" href={`/schedule/${row.id}`}>Pre-Session</Link>} />; }
function Encounters({ rows }: { rows: Array<Record<string, unknown> & { id: string }> }) { return <Table title="Encounters" rows={rows} columns={[["Started","started_at","datetime"],["Provider","providerName"],["Payer","payerName"],["Clinical","encounter_status","status"],["Billing","billing_status","status"],["Charges","chargeCount"],["Claims","claimCount"]]} action={(row) => <Link className="thera-action secondary" href={`/encounters/${row.id}`}>Open Encounter</Link>} />; }
function ClinicalNotes({ chart }: { chart: PatientChart }) { return <Table title="Clinical Notes" rows={chart.clinicalNotes} columns={[["Service Date","service_date","date"],["Provider","providerName"],["Type","note_type"],["Status","note_status","status"],["Signed","signed_at","datetime"]]} />; }
function Diagnoses({ chart }: { chart: PatientChart }) { return <Table title="Patient Diagnoses" rows={chart.diagnoses} columns={[["Code","diagnosis_code"],["Description","description"],["Status","diagnosis_status","status"],["Onset","onset_date","date"],["Resolved","resolved_date","date"]]} />; }
function Charges({ chart }: { chart: PatientChart }) {
  function correct(row: Record<string, unknown> & { id: string }) {
    const status = String(row.charge_status ?? "");
    if (!["blocked", "validation_failed", "held", "error"].includes(status)) return null;
    const reason = String(row.block_reason ?? row.blocking_reason ?? "Charge held for billing review.");
    const encounterId = String(row.encounter_id ?? "");
    const suggested = encounterId ? billingCorrectionLink({ message: reason }, encounterId, chart.patient.id) : null;
    const href = suggested?.href ?? `/billing/charges?tab=blocked&charge=${encodeURIComponent(row.id)}`;
    return { href, label: suggested?.label ?? "Review charge hold", reason };
  }
  return <Table title="Charges" rows={chart.charges} columns={[["DOS","service_date","date"],["CPT","cpt_code"],["Provider","providerName"],["Payer","payerName"],["Charge","charge_amount_cents","money"],["Status","charge_status","status"]]}
    cellLink={(row,key) => key === "charge_status" ? correct(row) : null}
    action={(row) => {
      const issue = correct(row);
      return issue ? <Link href={issue.href} className="thera-action secondary" title={issue.reason}>Fix: {issue.label} →</Link>
        : <Link href="/billing/charges" className="thera-action secondary">Charge Capture</Link>;
    }} />;
}
function Claims({ chart }: { chart: PatientChart }) { return <Table title="Claims" rows={chart.claims} columns={[["DOS","service_date_from","date"],["Control #","patient_control_number"],["Payer","payerName"],["Charge","total_charge_cents","money"],["Status","claim_status","status"]]} action={(row) => <Link className="thera-action secondary" href={`/claims/${row.id}`}>Claim 360</Link>} />; }
function Payments({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><Table title="Payments" rows={chart.payments} columns={[["Date","payment_date","date"],["Payer","payerName"],["Trace","trace_number"],["Amount","amount_cents","money"],["Status","posting_status","status"]]} /><section className="thera-card"><h2>Balance Summary</h2><div className="thera-kpi-value">{money(chart.openBalanceCents)}</div><p>Current open patient/claim balance from the patient balance summary.</p></section></div>; }
function DenialsAppeals({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><Table title="Denials" rows={chart.denials} columns={[["Date","denial_date","date"],["Payer","payerName"],["CARC","carc_code"],["RARC","rarc_code"],["Amount","amount_cents","money"],["Status","denial_status","status"]]} /><Table title="Appeals" rows={chart.appeals} columns={[["Created","created_at","datetime"],["Level","appeal_level"],["Status","appeal_status","status"],["Deadline","deadline_date","date"],["Outcome","outcome"]]} /></div>; }

function WorkItems({ rows }: { rows: Array<Record<string, unknown> & { id: string }> }) { return <Table title="Linked Work Items" rows={rows} columns={[["Created","created_at","datetime"],["Type","workqueue_type"],["Title","title"],["Priority","priority","status"],["Status","workqueue_status","status"]]} action={() => <Link className="thera-action secondary" href="/work-center">Work Center</Link>} />; }
function PortalCheckIn({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><PortalAccessPanel clientId={chart.patient.id} /><Table title="Check-In History" rows={chart.checkins} columns={[["Created","created_at","datetime"],["On My Way","on_my_way_at","datetime"],["Arrived","arrived_at","datetime"],["Checked In","checked_in_at","datetime"]]} /></div>; }

function Table({ title, rows, columns, action, cellLink }: { title: string; rows: Array<Record<string, unknown> & { id: string }>; columns: Array<[string,string,string?]>; action?: (row: Record<string, unknown> & { id: string }) => React.ReactNode; cellLink?: (row: Record<string, unknown> & { id: string }, key: string) => { href: string; label: string; reason: string } | null }) {
  return <section className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>{title}</h2><p>{rows.length} record{rows.length === 1 ? "" : "s"}</p></div></div>{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}{action && <th>Action</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{columns.map(([label,key,format]) => <td key={`${row.id}-${key}`}>{cellLink?.(row, key)
  ? <Link href={cellLink(row,key)!.href} className="thera-table-link" title={cellLink(row,key)!.reason} aria-label={`Fix ${cellLink(row,key)!.label}: ${cellLink(row,key)!.reason}`}>{renderValue(row[key], format)}</Link>
  : renderValue(row[key], format)}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table></div> : <div className="thera-empty">No {title.toLowerCase()}.</div>}</section>;
}
function renderValue(value: unknown, format?: string) { if (format === "status") return <StatusBadge value={String(value ?? "unknown")} />; if (format === "money") return money(Number(value ?? 0)); if (format === "date") return value ? shortDate(String(value)) : "—"; if (format === "datetime") return value ? dateTime(String(value)) : "—"; return String(value ?? "—"); }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>; }
function Field({ label, value }: { label: string; value: React.ReactNode }) { return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>; }
