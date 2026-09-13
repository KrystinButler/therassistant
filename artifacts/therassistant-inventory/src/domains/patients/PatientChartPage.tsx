import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import { AuthorizationPanel } from "../authorizations/AuthorizationPanel";
import { getClientChartRelationships } from "../clients/repository";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { InsurancePanel } from "../insurance/InsurancePanel";
import { JournalPanel } from "../journal/JournalPanel";
import { TreatmentPlanPanel } from "../treatment-plans/TreatmentPlanPanel";
import { DemographicsPanel } from "./DemographicsPanel";
import { getPatientChart } from "./repository";
import type { PatientChart } from "./types";

type Relationships = Awaited<ReturnType<typeof getClientChartRelationships>>;
type Tab = "overview" | "demographics" | "insurance" | "authorizations" | "appointments" | "encounters" | "treatment" | "notes" | "diagnoses" | "charges" | "claims" | "payments" | "denials" | "documents" | "journal" | "work" | "portal";

const tabs: Array<[Tab, string]> = [
  ["overview", "Overview"], ["demographics", "Demographics & Contacts"], ["insurance", "Insurance & Eligibility"],
  ["authorizations", "Authorizations"], ["appointments", "Appointments"], ["encounters", "Encounters"],
  ["treatment", "Treatment Plan & Goals"], ["notes", "Clinical Notes"], ["diagnoses", "Diagnoses"],
  ["charges", "Charges"], ["claims", "Claims"], ["payments", "Payments & Balances"], ["denials", "Denials / Appeals"],
  ["documents", "Documents"], ["journal", "Journal"], ["work", "Work Items"], ["portal", "Portal / Check-In"],
];

export function PatientChartPage() {
  const [, params] = useRoute<{ id: string }>("/clients/:id");
  const patientId = params?.id ?? "";
  const [chart, setChart] = useState<PatientChart | null>(null);
  const [relationships, setRelationships] = useState<Relationships | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
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

  return <>
    <div className="thera-breadcrumb"><Link className="thera-link" href="/clients">Patients</Link><span>/</span><span>{name}</span></div>
    <div className="thera-page-header split"><div><div className="thera-eyebrow">PATIENT CHART</div><h1>{name}</h1><p>{String(patient.email ?? "No email")} · {String(patient.phone ?? "No phone")} · DOB {shortDate(String(patient.date_of_birth ?? ""))}</p></div><div className="thera-header-badges"><StatusBadge value={String(patient.client_status ?? "active")} /><StatusBadge value={String(patient.registration_status ?? "not_started")} /></div></div>

    <div className="thera-metric-grid" style={{ marginBottom: 16 }}>
      <Metric label="Primary Payer" value={chart.summary.primaryPayerName} />
      <Metric label="Authorization" value={chart.summary.authorizationAlert} />
      <Metric label="Open Balance" value={money(chart.openBalanceCents)} />
      <Metric label="Open Work" value={linkedWork.filter((row) => ["open","in_progress","pending","snoozed","reopened"].includes(String(row.workqueue_status ?? ""))).length} />
    </div>

    <div className="thera-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? "thera-tab active" : "thera-tab"} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "overview" && <Overview chart={chart} relationships={relationships} setTab={setTab} />}
    {tab === "demographics" && <DemographicsPanel chart={chart} onChanged={load} />}
    {tab === "insurance" && <InsurancePanel chart={chart} onChanged={load} />}
    {tab === "authorizations" && <AuthorizationPanel chart={chart} onChanged={load} />}
    {tab === "appointments" && <Appointments chart={chart} />}
    {tab === "encounters" && <Encounters rows={relationships?.encounters ?? chart.encounters} />}
    {tab === "treatment" && <TreatmentPlanPanel chart={chart} onChanged={load} />}
    {tab === "notes" && <ClinicalNotes chart={chart} />}
    {tab === "diagnoses" && <Diagnoses chart={chart} />}
    {tab === "charges" && <Charges chart={chart} />}
    {tab === "claims" && <Claims chart={chart} />}
    {tab === "payments" && <Payments chart={chart} />}
    {tab === "denials" && <DenialsAppeals chart={chart} />}
    {tab === "documents" && <DocumentsPanel chart={chart} onChanged={load} />}
    {tab === "journal" && <JournalPanel chart={chart} onChanged={load} />}
    {tab === "work" && <WorkItems rows={linkedWork} />}
    {tab === "portal" && <PortalCheckIn chart={chart} />}
  </>;
}

function Overview({ chart, relationships, setTab }: { chart: PatientChart; relationships: Relationships | null; setTab: (tab: Tab) => void }) {
  const next = chart.appointments.filter((row) => new Date(String(row.starts_at ?? "")) >= new Date() && !["cancelled","no_show","completed"].includes(String(row.appointment_status ?? ""))).sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
  const activePlan = chart.treatmentPlans.find((row) => ["active","signed"].includes(String(row.status ?? "")));
  return <div className="thera-detail-grid">
    <section className="thera-card"><h2>Registration & Coverage</h2><div className="thera-definition-grid"><Field label="Registration" value={<StatusBadge value={chart.summary.registrationStatus} />} /><Field label="Primary Payer" value={chart.summary.primaryPayerName} /><Field label="Authorization" value={chart.summary.authorizationAlert} /><Field label="Treatment Plan" value={activePlan ? <StatusBadge value={String(activePlan.status)} /> : "None active"} /></div><div className="thera-filter-row" style={{ marginTop: 14 }}><button className="thera-action secondary" type="button" onClick={() => setTab("insurance")}>Coverage</button><button className="thera-action secondary" type="button" onClick={() => setTab("authorizations")}>Authorizations</button></div></section>
    <section className="thera-card"><h2>Next Appointment</h2>{next ? <><strong>{dateTime(String(next.starts_at ?? ""))}</strong><p>{String(next.service_type ?? "Appointment")} · {String(next.providerName ?? "—")}</p><Link className="thera-action secondary" href={`/schedule/${next.id}`}>Open Pre-Session</Link></> : <div className="thera-empty">No upcoming appointment.</div>}</section>
    <section className="thera-card"><h2>Clinical / Billing Spine</h2><div className="thera-definition-grid"><Field label="Encounters" value={relationships?.encounters.length ?? chart.encounters.length} /><Field label="Signed Notes" value={chart.clinicalNotes.filter((row) => row.note_status === "signed" || row.note_status === "locked").length} /><Field label="Charges" value={chart.charges.length} /><Field label="Claims" value={chart.claims.length} /></div></section>
    <section className="thera-card"><h2>Financial / Follow-Up</h2><div className="thera-definition-grid"><Field label="Open Balance" value={money(chart.openBalanceCents)} /><Field label="Payments" value={chart.payments.length} /><Field label="Denials" value={chart.denials.length} /><Field label="Appeals" value={chart.appeals.length} /></div></section>
  </div>;
}

function Appointments({ chart }: { chart: PatientChart }) { return <Table title="Appointments" rows={chart.appointments} columns={[["Date / Time","starts_at","datetime"],["Provider","providerName"],["Service","service_type"],["Location","location_type"],["Status","appointment_status","status"]]} action={(row) => <Link className="thera-action secondary" href={`/schedule/${row.id}`}>Pre-Session</Link>} />; }
function Encounters({ rows }: { rows: Array<Record<string, unknown> & { id: string }> }) { return <Table title="Encounters" rows={rows} columns={[["Started","started_at","datetime"],["Provider","providerName"],["Payer","payerName"],["Clinical","encounter_status","status"],["Billing","billing_status","status"],["Charges","chargeCount"],["Claims","claimCount"]]} action={(row) => <Link className="thera-action secondary" href={`/encounters/${row.id}`}>Open Encounter</Link>} />; }
function ClinicalNotes({ chart }: { chart: PatientChart }) { return <Table title="Clinical Notes" rows={chart.clinicalNotes} columns={[["Service Date","service_date","date"],["Provider","providerName"],["Type","note_type"],["Status","note_status","status"],["Signed","signed_at","datetime"]]} />; }
function Diagnoses({ chart }: { chart: PatientChart }) { return <Table title="Patient Diagnoses" rows={chart.diagnoses} columns={[["Code","diagnosis_code"],["Description","description"],["Status","diagnosis_status","status"],["Onset","onset_date","date"],["Resolved","resolved_date","date"]]} />; }
function Charges({ chart }: { chart: PatientChart }) { return <Table title="Charges" rows={chart.charges} columns={[["DOS","service_date","date"],["CPT","cpt_code"],["Provider","providerName"],["Payer","payerName"],["Charge","charge_amount_cents","money"],["Status","charge_status","status"]]} />; }
function Claims({ chart }: { chart: PatientChart }) { return <Table title="Claims" rows={chart.claims} columns={[["DOS","service_date_from","date"],["Control #","patient_control_number"],["Payer","payerName"],["Charge","total_charge_cents","money"],["Status","claim_status","status"]]} action={(row) => <Link className="thera-action secondary" href={`/claims/${row.id}`}>Claim 360</Link>} />; }
function Payments({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><Table title="Payments" rows={chart.payments} columns={[["Date","payment_date","date"],["Payer","payerName"],["Trace","trace_number"],["Amount","amount_cents","money"],["Status","posting_status","status"]]} /><section className="thera-card"><h2>Balance Summary</h2><div className="thera-kpi-value">{money(chart.openBalanceCents)}</div><p>Current open patient/claim balance from the patient balance summary.</p></section></div>; }
function DenialsAppeals({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><Table title="Denials" rows={chart.denials} columns={[["Date","denial_date","date"],["Payer","payerName"],["CARC","carc_code"],["RARC","rarc_code"],["Amount","amount_cents","money"],["Status","denial_status","status"]]} /><Table title="Appeals" rows={chart.appeals} columns={[["Created","created_at","datetime"],["Level","appeal_level"],["Status","appeal_status","status"],["Deadline","deadline_date","date"],["Outcome","outcome"]]} /></div>; }

function WorkItems({ rows }: { rows: Array<Record<string, unknown> & { id: string }> }) { return <Table title="Linked Work Items" rows={rows} columns={[["Created","created_at","datetime"],["Type","workqueue_type"],["Title","title"],["Priority","priority","status"],["Status","workqueue_status","status"]]} action={() => <Link className="thera-action secondary" href="/work-center">Work Center</Link>} />; }
function PortalCheckIn({ chart }: { chart: PatientChart }) { return <div className="thera-detail-grid"><section className="thera-card"><h2>Patient Portal</h2><p>Open the patient-facing view for appointments, check-in, coverage, forms, journal, and balance summary.</p><Link className="thera-action" href={`/patient-portal/${chart.patient.id}`}>Open Patient Portal</Link></section><Table title="Check-In History" rows={chart.checkins} columns={[["Created","created_at","datetime"],["On My Way","on_my_way_at","datetime"],["Arrived","arrived_at","datetime"],["Checked In","checked_in_at","datetime"]]} /></div>; }

function Table({ title, rows, columns, action }: { title: string; rows: Array<Record<string, unknown> & { id: string }>; columns: Array<[string,string,string?]>; action?: (row: Record<string, unknown> & { id: string }) => React.ReactNode }) {
  return <section className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>{title}</h2><p>{rows.length} record{rows.length === 1 ? "" : "s"}</p></div></div>{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}{action && <th>Action</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{columns.map(([label,key,format]) => <td key={`${row.id}-${key}`}>{renderValue(row[key], format)}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table></div> : <div className="thera-empty">No {title.toLowerCase()}.</div>}</section>;
}
function renderValue(value: unknown, format?: string) { if (format === "status") return <StatusBadge value={String(value ?? "unknown")} />; if (format === "money") return money(Number(value ?? 0)); if (format === "date") return value ? shortDate(String(value)) : "—"; if (format === "datetime") return value ? dateTime(String(value)) : "—"; return String(value ?? "—"); }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>; }
function Field({ label, value }: { label: string; value: React.ReactNode }) { return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>; }
