import { useEffect, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money } from "../../lib/format";
import { PatientPortalMobileNavigation } from "./PatientPortalNavigation";
import { downloadPortalDocument, getPatientPortalData, openPortalDocument, recordCheckIn } from "./repository";
import { PORTAL_JOURNAL, portalCheckInPath } from "./routes";

type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;

function patientName(row: Record<string, unknown>) {
  const preferred = String(row.preferred_name ?? "").trim();
  return [preferred || row.first_name, row.last_name].filter(Boolean).join(" ") || "Patient";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function PatientPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [documentWorking, setDocumentWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPatientPortalData()); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load patient portal."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function checkIn(appointmentId: string, step: "on_my_way" | "arrived" | "checked_in") {
    setWorking(`${appointmentId}-${step}`); setError(null);
    try { await recordCheckIn(appointmentId, step); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to update check-in."); }
    finally { setWorking(null); }
  }

  async function documentAction(documentId: string, action: "open" | "download") {
    setDocumentWorking(`${documentId}-${action}`);
    setError(null);
    try {
      if (action === "open") await openPortalDocument(documentId);
      else await downloadPortalDocument(documentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to access this document.");
    } finally {
      setDocumentWorking(null);
    }
  }

  if (loading) return <div className="thera-state">Loading patient portal...</div>;
  if (error && !data) return <div className="thera-state error">{error}</div>;
  if (!data) return <div className="thera-state error">Patient portal is unavailable.</div>;

  const checkinByAppointment = new Map(data.checkins.map((row) => [String(row.appointment_id ?? ""), row]));
  const recentJournalEntries = data.journalEntries.slice(0, 3);

  return <div className="ppn-home-page">
    <div className="thera-page-header split"><div><div className="thera-eyebrow">PATIENT PORTAL</div><h1>{patientName(data.patient)}</h1><p>Appointments, check-in, coverage confirmation, selected documents, journal, and balance summary.</p></div><div><StatusBadge value={String(data.patient.registration_status ?? "not_started")} /></div></div>
    {error && <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div>}

    <div className="thera-metric-grid" style={{ marginBottom: 18 }}>
      <Metric label="Upcoming Appointments" value={data.upcomingAppointments.length} />
      <Metric label="Active Coverage" value={data.insurancePolicies.filter((row) => row.status === "active").length} />
      <Metric label="Portal Documents" value={data.documents.length} />
      <Metric id="billing" label="Balance" value={money(data.openBalanceCents)} />
    </div>

    <div className="thera-detail-grid">
      <section id="appointments" className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Upcoming Appointments & Check-In</h2><p>Complete your pre-visit questions before the appointment, then use arrival check-in when you are on your way or at the office.</p></div></div>{data.upcomingAppointments.length ? <div className="thera-stack">{data.upcomingAppointments.map((appointment) => {
        const checkin = checkinByAppointment.get(appointment.id);
        const preVisit = recordOf(recordOf(checkin?.responses).pre_visit);
        const preVisitStarted = Object.keys(preVisit).length > 0;
        const preVisitSubmitted = Boolean(preVisit.submitted_at);
        const checkedIn = Boolean(checkin?.checked_in_at);
        const arrived = Boolean(checkin?.arrived_at);
        const onMyWay = Boolean(checkin?.on_my_way_at);
        const arrivalStep = checkedIn ? null : arrived ? "checked_in" : onMyWay ? "arrived" : "on_my_way";
        const arrivalLabel = checkedIn ? "Checked In ✓" : arrived ? "Check In" : onMyWay ? "I Arrived" : "On My Way";
        return <article className="thera-work-card" key={appointment.id}><div className="thera-work-card-top"><div><strong>{dateTime(String(appointment.starts_at ?? ""))}</strong><div className="thera-table-subtext">{String(appointment.service_type ?? "Appointment")} · {String(appointment.location_type ?? "").replaceAll("_", " ")}</div></div><StatusBadge value={String(appointment.appointment_status ?? "scheduled")} /></div><div className="thera-filter-row"><Link href={portalCheckInPath(appointment.id)} className="thera-action">{preVisitSubmitted ? "Review Pre-Visit Check-In" : preVisitStarted ? "Continue Pre-Visit Check-In" : "Start Pre-Visit Check-In"}</Link><button type="button" className={checkedIn ? "thera-action secondary" : "thera-action"} disabled={checkedIn || working !== null || arrivalStep === null} onClick={() => arrivalStep && void checkIn(appointment.id, arrivalStep)}>{working?.startsWith(`${appointment.id}-`) ? "Updating..." : arrivalLabel}</button></div></article>;
      })}</div> : <div className="thera-empty">No upcoming appointments.</div>}</section>

      <section id="profile" className="thera-card"><h2>Demographics</h2><div className="thera-definition-grid"><Field label="Name" value={patientName(data.patient)} /><Field label="DOB" value={String(data.patient.date_of_birth ?? "—")} /><Field label="Phone" value={String(data.patient.phone ?? "—")} /><Field label="Email" value={String(data.patient.email ?? "—")} /><Field label="Address" value={[data.patient.address_line1, data.patient.city, data.patient.state, data.patient.postal_code].filter(Boolean).join(", ") || "—"} /></div><p className="thera-muted" style={{ marginTop: 12 }}>Demographic changes are handled through the practice workflow; the portal does not expose administrative fields.</p></section>

      <section id="coverage" className="thera-card"><h2>Insurance</h2>{data.insurancePolicies.length ? <div className="thera-stack">{data.insurancePolicies.map((policy) => <div key={policy.id} className="thera-report-list-row"><div><strong>{String(policy.insurance_order ?? "coverage").replaceAll("_", " ")}</strong><div className="thera-table-subtext">Member {String(policy.member_id ?? "—")} · Group {String(policy.group_number ?? "—")}</div></div><StatusBadge value={String(policy.status ?? "unknown")} /></div>)}</div> : <div className="thera-empty">No coverage on file.</div>}</section>

      <section id="documents" className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Forms & Documents</h2><p>Open or download the forms, correspondence, insurance cards, and statements shared with you.</p></div></div>{data.documents.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Status</th><th>File</th></tr></thead><tbody>{data.documents.map((row) => {
        const id = String(row.id ?? "");
        const busy = documentWorking?.startsWith(`${id}-`) ?? false;
        return <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.document_type ?? "other").replaceAll("_", " ")}</td><td>{String(row.file_name ?? "—")}</td><td><StatusBadge value={String(row.document_status ?? "uploaded")} /></td><td><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={busy} onClick={() => void documentAction(id, "open")}>{documentWorking === `${id}-open` ? "Opening..." : "Open"}</button><button type="button" className="thera-action secondary" disabled={busy} onClick={() => void documentAction(id, "download")}>{documentWorking === `${id}-download` ? "Downloading..." : "Download"}</button></div></td></tr>;
      })}</tbody></table></div> : <div className="thera-empty">No patient-facing documents.</div>}</section>

      <section className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>In-Between Session Journal</h2><p>Capture thoughts, symptoms, progress, and questions between visits. Entries stay patient-authored until a clinician deliberately incorporates relevant information into the clinical record.</p></div><Link href={PORTAL_JOURNAL} className="thera-action">Open Journal</Link></div>
        {recentJournalEntries.length ? <div className="thera-stack">{recentJournalEntries.map((entry) => <article key={entry.id} className="thera-work-card"><div className="thera-work-card-top"><strong>{String(entry.mood ?? "Reflection").replaceAll("_", " ")}</strong><span className="thera-muted">{dateTime(String(entry.created_at ?? ""))}</span></div><p>{String(entry.entry_text ?? "")}</p></article>)}</div> : <div className="thera-empty">No journal entries yet. Open the journal to write your first reflection.</div>}
      </section>
    </div>
    <PatientPortalMobileNavigation active="home" />
  </div>;
}

function Metric({ id, label, value }: { id?: string; label: string; value: string | number }) { return <div id={id} className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>; }
function Field({ label, value }: { label: string; value: string }) { return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>; }
