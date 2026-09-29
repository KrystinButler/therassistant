import { useEffect, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money } from "../../lib/format";
import { PatientMessagesPanel } from "./PatientMessagesPanel";
import { PatientPortalMobileNavigation } from "./PatientPortalNavigation";
import { downloadPortalDocument, getPatientPortalData, openPortalDocument, recordCheckIn, submitPortalChangeRequest, submitPortalScheduleChange, uploadPortalInsuranceCard } from "./repository";
import { PORTAL_JOURNAL, portalCheckInPath } from "./routes";
import { getPortalArrivalAvailability } from "./workflow";

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
  const [insuranceUploadWorking, setInsuranceUploadWorking] = useState(false);
  const [changeRequestType, setChangeRequestType] = useState<"demographics" | "insurance" | null>(null);
  const [changeDetails, setChangeDetails] = useState("");
  const [changeWorking, setChangeWorking] = useState(false);
  const [scheduleRequest, setScheduleRequest] = useState<{ appointmentId: string; type: "cancel" | "reschedule" } | null>(null);
  const [scheduleDetails, setScheduleDetails] = useState("");
  const [scheduleWorking, setScheduleWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  async function uploadInsuranceCard(file: File | null) {
    if (!file) return;
    setInsuranceUploadWorking(true);
    setError(null);
    setNotice(null);
    try {
      await uploadPortalInsuranceCard(file);
      setNotice("Your insurance card was uploaded securely and sent to the practice for review.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload your insurance card.");
    } finally {
      setInsuranceUploadWorking(false);
    }
  }

  async function submitChangeRequest() {
    if (!changeRequestType) return;
    setChangeWorking(true);
    setError(null);
    setNotice(null);
    try {
      await submitPortalChangeRequest(changeRequestType, changeDetails);
      setNotice(changeRequestType === "demographics"
        ? "Your demographic update request was sent to the practice work queue."
        : "Your insurance update request was sent to the practice work queue.");
      setChangeRequestType(null);
      setChangeDetails("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit your change request.");
    } finally {
      setChangeWorking(false);
    }
  }

  async function submitScheduleRequest() {
    if (!scheduleRequest) return;
    setScheduleWorking(true);
    setError(null);
    setNotice(null);
    try {
      await submitPortalScheduleChange(scheduleRequest.appointmentId, scheduleRequest.type, scheduleDetails);
      setNotice(scheduleRequest.type === "cancel"
        ? "Your cancellation request was sent to the practice. Your appointment remains scheduled until staff confirms the change."
        : "Your reschedule request was sent to the practice. Your appointment remains scheduled until staff confirms a new time.");
      setScheduleRequest(null);
      setScheduleDetails("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit your schedule change request.");
    } finally {
      setScheduleWorking(false);
    }
  }

  if (loading) return <div className="thera-state">Loading patient portal...</div>;
  if (error && !data) return <div className="thera-state error">{error}</div>;
  if (!data) return <div className="thera-state error">Patient portal is unavailable.</div>;

  const checkinByAppointment = new Map(data.checkins.map((row) => [String(row.appointment_id ?? ""), row]));
  const recentJournalEntries = data.journalEntries.slice(0, 3);
  const statementDocuments = data.documents.filter((row) => String(row.document_type ?? "") === "statement");
  const generalDocuments = data.documents.filter((row) => String(row.document_type ?? "") !== "statement");

  return <div className="ppn-home-page">
    <div className="thera-page-header split"><div><div className="thera-eyebrow">PATIENT PORTAL</div><h1>{patientName(data.patient)}</h1><p>Appointments, check-in, coverage confirmation, selected documents, journal, and balance summary.</p></div><div><StatusBadge value={String(data.patient.registration_status ?? "not_started")} /></div></div>
    {error && <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div>}
    {notice && <div className="thera-alert" style={{ marginBottom: 16 }}>{notice}</div>}

    <div className="thera-metric-grid" style={{ marginBottom: 18 }}>
      <Metric label="Upcoming Appointments" value={data.upcomingAppointments.length} />
      <Metric label="Active Coverage" value={data.insurancePolicies.filter((row) => row.status === "active").length} />
      <Metric label="Portal Documents" value={data.documents.length} />
      <Metric label="Balance" value={money(data.openBalanceCents)} />
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
        const arrivalAvailability = getPortalArrivalAvailability(appointment);
        const arrivalEnabled = arrivalStep === "on_my_way" ? arrivalAvailability.onMyWay : arrivalAvailability.arrival;
        const arrivalTimingText = !checkedIn && !arrivalEnabled
          ? arrivalStep === "on_my_way"
            ? "Arrival check-in opens 4 hours before your appointment."
            : "Arrival and final check-in open 1 hour before your appointment."
          : "";
        const canRequestScheduleChange = ["scheduled", "confirmed"].includes(String(appointment.appointment_status ?? "scheduled").toLowerCase()) && new Date(String(appointment.starts_at ?? "")).getTime() > Date.now();
        return <article className="thera-work-card" key={appointment.id}><div className="thera-work-card-top"><div><strong>{dateTime(String(appointment.starts_at ?? ""))}</strong><div className="thera-table-subtext">{String(appointment.service_type ?? "Appointment")} · {String(appointment.location_type ?? "").replaceAll("_", " ")}</div></div><StatusBadge value={String(appointment.appointment_status ?? "scheduled")} /></div><div className="thera-filter-row"><Link href={portalCheckInPath(appointment.id)} className="thera-action">{preVisitSubmitted ? "Review Pre-Visit Check-In" : preVisitStarted ? "Continue Pre-Visit Check-In" : "Start Pre-Visit Check-In"}</Link><button type="button" className={checkedIn || !arrivalEnabled ? "thera-action secondary" : "thera-action"} disabled={checkedIn || working !== null || arrivalStep === null || !arrivalEnabled} onClick={() => arrivalStep && arrivalEnabled && void checkIn(appointment.id, arrivalStep)}>{working?.startsWith(`${appointment.id}-`) ? "Updating..." : arrivalLabel}</button>{canRequestScheduleChange && <><button type="button" className="thera-action secondary" onClick={() => { setScheduleRequest({ appointmentId: appointment.id, type: "reschedule" }); setScheduleDetails(""); setNotice(null); }}>Request Reschedule</button><button type="button" className="thera-action secondary" onClick={() => { setScheduleRequest({ appointmentId: appointment.id, type: "cancel" }); setScheduleDetails(""); setNotice(null); }}>Request Cancellation</button></>}</div>{arrivalTimingText && <div className="thera-muted" style={{ marginTop: 8 }}>{arrivalTimingText}</div>}{scheduleRequest?.appointmentId === appointment.id && <ScheduleRequestForm type={scheduleRequest.type} details={scheduleDetails} working={scheduleWorking} onDetails={setScheduleDetails} onSubmit={() => void submitScheduleRequest()} onCancel={() => { setScheduleRequest(null); setScheduleDetails(""); }} />}</article>;
      })}</div> : <div className="thera-empty">No upcoming appointments.</div>}</section>

      <section id="appointment-history" className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>Appointment History</h2><p>Recent completed, cancelled, rescheduled, and past appointments.</p></div></div>
        {data.appointmentHistory.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Service</th><th>Location</th><th>Status</th></tr></thead><tbody>{data.appointmentHistory.slice(0, 12).map((appointment) => <tr key={appointment.id}><td>{dateTime(String(appointment.starts_at ?? ""))}</td><td>{String(appointment.service_type ?? "Appointment")}</td><td>{String(appointment.location_type ?? "—").replaceAll("_", " ")}</td><td><StatusBadge value={String(appointment.appointment_status ?? "scheduled")} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No appointment history yet.</div>}
      </section>

      <section id="profile" className="thera-card"><div className="thera-card-header split"><div><h2>Demographics</h2><p>Review the information the practice has on file.</p></div><button type="button" className="thera-action secondary" onClick={() => { setChangeRequestType("demographics"); setChangeDetails(""); setNotice(null); }}>Report a Change</button></div><div className="thera-definition-grid"><Field label="Name" value={patientName(data.patient)} /><Field label="DOB" value={String(data.patient.date_of_birth ?? "—")} /><Field label="Phone" value={String(data.patient.phone ?? "—")} /><Field label="Email" value={String(data.patient.email ?? "—")} /><Field label="Address" value={[data.patient.address_line1, data.patient.city, data.patient.state, data.patient.postal_code].filter(Boolean).join(", ") || "—"} /></div>{changeRequestType === "demographics" && <ChangeRequestForm type="demographics" details={changeDetails} working={changeWorking} onDetails={setChangeDetails} onSubmit={() => void submitChangeRequest()} onCancel={() => { setChangeRequestType(null); setChangeDetails(""); }} />}</section>

      <section id="coverage" className="thera-card">
        <div className="thera-card-header split"><div><h2>Insurance</h2><p>Review your coverage information and securely send a replacement insurance card.</p></div><button type="button" className="thera-action secondary" onClick={() => { setChangeRequestType("insurance"); setChangeDetails(""); setNotice(null); }}>Report Insurance Change</button></div>
        {data.insurancePolicies.length ? <div className="thera-stack">{data.insurancePolicies.map((policy) => <div key={policy.id} className="thera-report-list-row"><div><strong>{String(policy.insurance_order ?? "coverage").replaceAll("_", " ")}</strong><div className="thera-table-subtext">Member {String(policy.member_id ?? "—")} · Group {String(policy.group_number ?? "—")}</div></div><StatusBadge value={String(policy.status ?? "unknown")} /></div>)}</div> : <div className="thera-empty">No coverage on file.</div>}
        <div className="thera-form-grid" style={{ marginTop: 14 }}>
          <label className="thera-field thera-span-2"><span className="thera-field-label">Upload insurance card</span><input className="thera-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={insuranceUploadWorking} onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ""; void uploadInsuranceCard(file); }} /></label>
          <p className="thera-muted" style={{ margin: 0 }}>{insuranceUploadWorking ? "Uploading securely..." : "Accepted: PDF, JPG, PNG, or WebP. Upload front and back as separate files when needed."}</p>
        </div>
        {changeRequestType === "insurance" && <ChangeRequestForm type="insurance" details={changeDetails} working={changeWorking} onDetails={setChangeDetails} onSubmit={() => void submitChangeRequest()} onCancel={() => { setChangeRequestType(null); setChangeDetails(""); }} />}
      </section>

      <PatientMessagesPanel />

      <section id="billing" className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>Billing & Statements</h2><p>Review your current balance, patient payments, and statements shared by the practice.</p></div></div>
        <div className="thera-definition-grid" style={{ marginBottom: 14 }}><Field label="Current balance" value={money(data.openBalanceCents)} /><Field label="Patient payments shown" value={String(data.patientPayments.length)} /></div>
        <h3 style={{ margin: "0 0 8px" }}>Payment History</h3>
        {data.patientPayments.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>{data.patientPayments.slice(0, 20).map((payment) => <tr key={payment.id}><td>{String(payment.payment_date ?? "—")}</td><td>{String(payment.payment_method ?? "other").replaceAll("_", " ")}</td><td>{money(Number(payment.amount_cents ?? 0))}</td><td><StatusBadge value={String(payment.payment_status ?? "posted")} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No patient payment history is available.</div>}
        <h3 style={{ margin: "18px 0 8px" }}>Statements</h3>
        {statementDocuments.length ? <div className="thera-stack">{statementDocuments.map((row) => { const id = String(row.id ?? ""); const busy = documentWorking?.startsWith(`${id}-`) ?? false; return <div key={row.id} className="thera-report-list-row"><div><strong>{String(row.file_name ?? "Statement")}</strong><div className="thera-table-subtext">{dateTime(String(row.created_at ?? ""))}</div></div><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={busy} onClick={() => void documentAction(id, "open")}>Open</button><button type="button" className="thera-action secondary" disabled={busy} onClick={() => void documentAction(id, "download")}>Download</button></div></div>; })}</div> : <div className="thera-empty">No statements have been shared with you.</div>}
      </section>

      <section id="documents" className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Forms & Documents</h2><p>Open or download forms, correspondence, and insurance cards shared with you.</p></div></div>{generalDocuments.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Type</th><th>Name</th><th>Status</th><th>File</th></tr></thead><tbody>{generalDocuments.map((row) => {
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

function ChangeRequestForm({ type, details, working, onDetails, onSubmit, onCancel }: {
  type: "demographics" | "insurance";
  details: string;
  working: boolean;
  onDetails: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const label = type === "demographics"
    ? "Tell the practice what demographic information needs to be updated."
    : "Tell the practice what changed with your insurance. Staff will follow up if they need a new card.";
  return <div className="thera-form-grid" style={{ marginTop: 14 }}>
    <label className="thera-field thera-span-2"><span className="thera-field-label">{label}</span><textarea className="thera-input" rows={4} maxLength={2000} value={details} onChange={(event) => onDetails(event.target.value)} placeholder={type === "demographics" ? "Example: My phone number and address changed..." : "Example: I have a new insurance plan effective October 1..."} /></label>
    <div className="thera-filter-row"><button type="button" className="thera-action" disabled={working || !details.trim()} onClick={onSubmit}>{working ? "Sending..." : "Send Update Request"}</button><button type="button" className="thera-action secondary" disabled={working} onClick={onCancel}>Cancel</button></div>
  </div>;
}


function ScheduleRequestForm({ type, details, working, onDetails, onSubmit, onCancel }: {
  type: "cancel" | "reschedule";
  details: string;
  working: boolean;
  onDetails: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const label = type === "cancel"
    ? "Tell the practice why you need to cancel. Staff must confirm the cancellation."
    : "Tell the practice what days or times work better. Staff will contact you to confirm a new appointment.";
  return <div className="thera-form-grid" style={{ marginTop: 14 }}>
    <label className="thera-field thera-span-2"><span className="thera-field-label">{label}</span><textarea className="thera-input" rows={3} maxLength={2000} value={details} onChange={(event) => onDetails(event.target.value)} placeholder={type === "cancel" ? "Example: I am unable to attend this appointment..." : "Example: I am available Tuesday or Thursday afternoon..."} /></label>
    <div className="thera-filter-row"><button type="button" className="thera-action" disabled={working || !details.trim()} onClick={onSubmit}>{working ? "Sending..." : type === "cancel" ? "Send Cancellation Request" : "Send Reschedule Request"}</button><button type="button" className="thera-action secondary" disabled={working} onClick={onCancel}>Keep Appointment</button></div>
    <p className="thera-muted" style={{ margin: 0 }}>Your appointment does not change until the practice confirms your request.</p>
  </div>;
}
