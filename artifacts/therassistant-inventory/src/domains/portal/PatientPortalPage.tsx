import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money } from "../../lib/format";
import { getPatientPortalData, recordCheckIn } from "./repository";

type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;

function patientName(row: Record<string, unknown>) {
  const preferred = String(row.preferred_name ?? "").trim();
  return [preferred || row.first_name, row.last_name].filter(Boolean).join(" ") || "Patient";
}

export function PatientPortalPage() {
  const [, params] = useRoute<{ clientId: string }>("/patient-portal/:clientId");
  const clientId = params?.clientId ?? "";
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!clientId) return;
    setLoading(true); setError(null);
    try { setData(await getPatientPortalData(clientId)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load patient portal."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [clientId]);

  async function checkIn(appointmentId: string, step: "on_my_way" | "arrived" | "checked_in") {
    setWorking(`${appointmentId}-${step}`); setError(null);
    try { await recordCheckIn(appointmentId, clientId, step); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to update check-in."); }
    finally { setWorking(null); }
  }

  if (loading) return <div className="thera-state">Loading patient portal...</div>;
  if (error && !data) return <div className="thera-state error">{error}</div>;
  if (!data) return <div className="thera-state error">Patient portal is unavailable.</div>;

  const checkinByAppointment = new Map(data.checkins.map((row) => [String(row.appointment_id ?? ""), row]));
  const recentJournalEntries = data.journalEntries.slice(0, 3);

  return <>
    <div className="thera-page-header split"><div><div className="thera-eyebrow">PATIENT PORTAL · SYNTHETIC DEMO</div><h1>{patientName(data.patient)}</h1><p>Appointments, check-in, coverage confirmation, selected documents, journal, and balance summary.</p></div><div><StatusBadge value={String(data.patient.registration_status ?? "not_started")} /></div></div>
    {error && <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div>}

    <div className="thera-metric-grid" style={{ marginBottom: 18 }}>
      <Metric label="Upcoming Appointments" value={data.upcomingAppointments.length} />
      <Metric label="Active Coverage" value={data.insurancePolicies.filter((row) => row.status === "active").length} />
      <Metric label="Portal Documents" value={data.documents.length} />
      <Metric label="Balance" value={money(data.openBalanceCents)} />
    </div>

    <div className="thera-detail-grid">
      <section className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Upcoming Appointments & Check-In</h2><p>Check-in status is saved to the same appointment record context used by the practice schedule.</p></div></div>{data.upcomingAppointments.length ? <div className="thera-stack">{data.upcomingAppointments.map((appointment) => { const checkin = checkinByAppointment.get(appointment.id); return <article className="thera-work-card" key={appointment.id}><div className="thera-work-card-top"><div><strong>{dateTime(String(appointment.starts_at ?? ""))}</strong><div className="thera-table-subtext">{String(appointment.service_type ?? "Appointment")} · {String(appointment.location_type ?? "").replaceAll("_", " ")}</div></div><StatusBadge value={String(appointment.appointment_status ?? "scheduled")} /></div><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={Boolean(checkin?.on_my_way_at) || working !== null} onClick={() => void checkIn(appointment.id, "on_my_way")}>{checkin?.on_my_way_at ? "On My Way ✓" : "On My Way"}</button><button type="button" className="thera-action secondary" disabled={Boolean(checkin?.arrived_at) || working !== null} onClick={() => void checkIn(appointment.id, "arrived")}>{checkin?.arrived_at ? "Arrived ✓" : "I Arrived"}</button><button type="button" className="thera-action" disabled={Boolean(checkin?.checked_in_at) || working !== null} onClick={() => void checkIn(appointment.id, "checked_in")}>{checkin?.checked_in_at ? "Checked In ✓" : "Check In"}</button></div></article>; })}</div> : <div className="thera-empty">No upcoming appointments.</div>}</section>

      <section className="thera-card"><h2>Demographics</h2><div className="thera-definition-grid"><Field label="Name" value={patientName(data.patient)} /><Field label="DOB" value={String(data.patient.date_of_birth ?? "—")} /><Field label="Phone" value={String(data.patient.phone ?? "—")} /><Field label="Email" value={String(data.patient.email ?? "—")} /><Field label="Address" value={[data.patient.address_line1, data.patient.city, data.patient.state, data.patient.postal_code].filter(Boolean).join(", ") || "—"} /></div><p className="thera-muted" style={{ marginTop: 12 }}>Demographic changes are handled through the practice workflow in this demo; the portal deliberately does not expose administrative fields.</p></section>

      <section className="thera-card"><h2>Insurance</h2>{data.insurancePolicies.length ? <div className="thera-stack">{data.insurancePolicies.map((policy) => <div key={policy.id} className="thera-report-list-row"><div><strong>{String(policy.insurance_order ?? "coverage").replaceAll("_", " ")}</strong><div className="thera-table-subtext">Member {String(policy.member_id ?? "—")} · Group {String(policy.group_number ?? "—")}</div></div><StatusBadge value={String(policy.status ?? "unknown")} /></div>)}</div> : <div className="thera-empty">No coverage on file.</div>}</section>

      <section className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Forms & Documents</h2><p>Only patient-facing document categories are shown here.</p></div></div>{data.documents.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Status</th></tr></thead><tbody>{data.documents.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.document_type ?? "other").replaceAll("_", " ")}</td><td>{String(row.file_name ?? "—")}</td><td><StatusBadge value={String(row.document_status ?? "uploaded")} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No patient-facing documents.</div>}</section>

      <section className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>In-Between Session Journal</h2><p>Capture thoughts, symptoms, progress, and questions between visits. Entries stay patient-authored until a clinician deliberately incorporates relevant information into the clinical record.</p></div><Link href={`/patient-portal/${clientId}/journal`} className="thera-action">Open Journal</Link></div>
        {recentJournalEntries.length ? <div className="thera-stack">{recentJournalEntries.map((entry) => <article key={entry.id} className="thera-work-card"><div className="thera-work-card-top"><strong>{String(entry.mood ?? "Reflection").replaceAll("_", " ")}</strong><span className="thera-muted">{dateTime(String(entry.created_at ?? ""))}</span></div><p>{String(entry.entry_text ?? "")}</p></article>)}</div> : <div className="thera-empty">No journal entries yet. Open the journal to write your first reflection.</div>}
      </section>
    </div>
  </>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>; }
function Field({ label, value }: { label: string; value: string }) { return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>; }
