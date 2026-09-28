import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BookOpenText, CalendarDays, CheckCircle2, ChevronRight,
  ClipboardCheck, Clock3, CreditCard, FileText, Heart, Home,
  MapPin, RefreshCw, ShieldCheck, UserRound,
} from "lucide-react";
import { Link } from "wouter";

import { dateTime, money } from "../../lib/format";
import { getPatientPortalData, recordCheckIn } from "./repository";
import { PORTAL_HOME, PORTAL_JOURNAL, portalCheckInPath } from "./routes";
import "./patient-journal.css";
import "./patient-home.css";

type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function firstName(patient: Record<string, unknown>) {
  return text(patient.preferred_name || patient.first_name, "there");
}

function patientName(patient: Record<string, unknown>) {
  return [patient.preferred_name || patient.first_name, patient.last_name]
    .filter(Boolean).join(" ") || "Patient";
}

function providerName(provider: Record<string, unknown> | null) {
  if (!provider) return "Your care team";
  return [provider.first_name, provider.last_name].filter(Boolean).join(" ") || "Your care team";
}

function appointmentDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "Date not available";
}

function appointmentTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "Time not available";
}

export function PatientPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const arrivalPending = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function load(initial = false) {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await getPatientPortalData();
      setData(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the patient portal.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(true); }, []);

  async function checkIn(appointmentId: string, step: "on_my_way" | "arrived" | "checked_in") {
    if (arrivalPending.current) return;
    arrivalPending.current = true;
    setWorking(`${appointmentId}-${step}`);
    setError(null);
    try {
      await recordCheckIn(appointmentId, step);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update arrival. Please try again.");
    } finally {
      arrivalPending.current = false;
      setWorking(null);
    }
  }

  if (loading) return <div className="pj-loading">Loading your patient portal...</div>;
  if (!data) return <main className="pj-loading pj-error" role="alert">{error ?? "Your patient portal is unavailable."}<button type="button" className="pj-primary-button" onClick={() => void load(true)}>Try again</button></main>;

  return <PatientPortalView data={data} refreshing={refreshing} error={error} working={working} load={load} checkIn={checkIn} />;
}

export function PatientPortalView({ data, refreshing, error, working, load, checkIn }: {
  data: PortalData;
  refreshing: boolean;
  error: string | null;
  working: string | null;
  load: () => void;
  checkIn: (appointmentId: string, step: "on_my_way" | "arrived" | "checked_in") => Promise<void>;
}) {
  const next = data.upcomingAppointments[0];
  const relatedCheckIn = next
    ? data.checkins.find((row) => String(row.appointment_id ?? "") === next.id)
    : null;
  const preVisit = recordOf(recordOf(relatedCheckIn?.responses).pre_visit);
  const preVisitSubmitted = Boolean(preVisit.submitted_at);
  const preVisitStarted = Object.keys(preVisit).length > 0;
  const activeCoverage = data.insurancePolicies.filter((row) => row.status === "active");
  const recentJournal = data.journalEntries.slice(0, 2);
  const patientDisplayName = patientName(data.patient);
  const name = firstName(data.patient);
  const nextCheckIn = next ? portalCheckInPath(next.id) : null;

  return (
    <div className="pj-app ph-app">
      <header className="pj-topbar">
        <Link href={PORTAL_HOME} className="pj-brand" aria-label="Therassistant patient portal home">
          <span className="pj-logo-mark" aria-hidden="true"><span>▲</span><span>▲</span><span>▲</span></span>
          <span><strong>THERASSISTANT</strong><small>PATIENT PORTAL</small></span>
        </Link>
        <div className="pj-topbar-right">
          <span className="pj-care-message">Your care, in one place.</span>
          <span className="pj-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
          <span className="pj-user"><strong>{patientDisplayName}</strong><small>Patient account</small></span>
        </div>
      </header>

      <div className="pj-layout ph-layout">
        <aside className="pj-sidebar">
          <div className="pj-welcome"><small>Welcome back,</small><strong>{name}</strong></div>
          <div className="pj-mountains" aria-hidden="true">⌁⌁⌁</div>
          <p className="pj-progress-copy">A simpler way to stay connected with your care.</p>
          <nav className="pj-nav" aria-label="Patient portal navigation">
            <Link href={PORTAL_HOME} className="active"><Home size={17} /> Home</Link>
            <a href="#appointments"><CalendarDays size={17} /> Appointments</a>
            <Link href={PORTAL_JOURNAL}><BookOpenText size={17} /> My journal</Link>
            <a href="#documents"><FileText size={17} /> Documents</a>
            <a href="#billing"><CreditCard size={17} /> Billing</a>
            <a href="#profile"><UserRound size={17} /> My profile</a>
          </nav>
          <p className="pj-sidebar-quote"><ShieldCheck size={17} aria-hidden="true" /> Your information stays in your patient account.</p>
        </aside>

        <main className="pj-main ph-main" id="main-content">
          <nav className="ph-mobile-nav" aria-label="Patient portal quick navigation">
            <a href="#appointments"><CalendarDays size={16} /> Visits</a>
            <Link href={PORTAL_JOURNAL}><BookOpenText size={16} /> Journal</Link>
            <a href="#documents"><FileText size={16} /> Documents</a>
            <a href="#billing"><CreditCard size={16} /> Billing</a>
          </nav>

          <div className="ph-heading">
            <div><p className="ph-eyebrow">YOUR PATIENT PORTAL</p><h1>Welcome back, {name}.</h1><p>See your next visit and take care of what matters before you arrive.</p></div>
            <button type="button" className="ph-refresh" onClick={() => void load()} disabled={refreshing} aria-label="Refresh patient portal"><RefreshCw size={15} aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh"}</button>
          </div>
          {error && <div className="pj-message error" role="alert">{error} Your previous information is still shown.</div>}

          <section className="ph-next" id="appointments" aria-labelledby="ph-next-title">
            <div className="ph-next-decoration" aria-hidden="true" />
            <div className="ph-next-top"><span><CalendarDays size={17} aria-hidden="true" /> YOUR NEXT APPOINTMENT</span>{next && <span className="ph-status">{appointmentStatus(next.appointment_status)}</span>}</div>
            {next ? <>
              <h2 id="ph-next-title">{appointmentDate(next.starts_at)}</h2>
              <p className="ph-next-time"><Clock3 size={17} aria-hidden="true" /> {appointmentTime(next.starts_at)} – {appointmentTime(next.ends_at)}</p>
              <div className="ph-next-details">
                <span><Heart size={16} aria-hidden="true" /> {text(next.service_type, "Therapy appointment")}</span>
                <span><MapPin size={16} aria-hidden="true" /> {text(next.location_type, "Location on file").replaceAll("_", " ")}</span>
              </div>
              <div className="ph-next-bottom">
                <div className="ph-checkin-state">{preVisitSubmitted ? <CheckCircle2 size={18} /> : <ClipboardCheck size={18} />}{preVisitSubmitted ? "Your pre-visit questions have been submitted." : preVisitStarted ? "Your pre-visit questions are in progress." : "Complete your pre-visit questions before your appointment."}</div>
                {nextCheckIn && <Link className="ph-next-button" href={nextCheckIn}>{preVisitSubmitted ? "Review pre-visit questions" : preVisitStarted ? "Continue pre-visit questions" : "Start pre-visit questions"} <ArrowRight size={16} aria-hidden="true" /></Link>}
              </div>
              <ArrivalActions appointment={next} checkin={relatedCheckIn} working={working} checkIn={checkIn} />
            </> : <>
              <h2 id="ph-next-title">No upcoming appointment on your calendar</h2>
              <p className="ph-no-visit">Only upcoming appointments that are open for check-in appear here. If you expected a visit, contact your practice to confirm its status.</p>
              <div className="ph-next-bottom"><span className="ph-checkin-state"><ShieldCheck size={18} /> Check-in will be available when a scheduled visit is added.</span></div>
            </>}
            {data.upcomingAppointments.length > 1 && <div className="ph-more-visits">
              <strong>Later appointments</strong>
              {data.upcomingAppointments.slice(1).map((appointment) => <article key={appointment.id} className="ph-later-visit"><div><span>{dateTime(String(appointment.starts_at))}</span><span className="ph-status">{appointmentStatus(appointment.appointment_status)}</span></div><Link href={portalCheckInPath(appointment.id)}>Pre-visit questions <ChevronRight size={13} /></Link><ArrivalActions appointment={appointment} checkin={data.checkins.find((row) => String(row.appointment_id ?? "") === appointment.id)} working={working} checkIn={checkIn} /></article>)}
            </div>}
          </section>

          <section className="ph-section" aria-labelledby="ph-actions-title">
            <div className="ph-section-heading"><h2 id="ph-actions-title">Your next steps</h2><p>Quick access to what you need most.</p></div>
            <div className="ph-action-grid">
              {nextCheckIn ? <Link href={nextCheckIn} className="ph-action-card"><span className="ph-action-icon sage"><ClipboardCheck size={22} /></span><strong>{preVisitSubmitted ? "Review your check-in" : "Pre-visit check-in"}</strong><span>{preVisitSubmitted ? "View the information you submitted" : "Confirm details and answer visit questions"}</span><ChevronRight className="ph-card-chevron" size={17} /></Link>
                : <div className="ph-action-card ph-action-disabled"><span className="ph-action-icon sage"><ClipboardCheck size={22} /></span><strong>Pre-visit check-in</strong><span>Available with your next scheduled appointment</span></div>}
              <Link href={PORTAL_JOURNAL} className="ph-action-card"><span className="ph-action-icon blue"><BookOpenText size={22} /></span><strong>My journal</strong><span>Write a reflection between sessions</span><ChevronRight className="ph-card-chevron" size={17} /></Link>
              <a href="#documents" className="ph-action-card"><span className="ph-action-icon cream"><FileText size={22} /></span><strong>Forms & documents</strong><span>View patient-facing documents on file</span><ChevronRight className="ph-card-chevron" size={17} /></a>
            </div>
          </section>

          <div className="ph-content-grid">
            <section className="ph-panel" aria-labelledby="ph-journal-title">
              <div className="ph-panel-heading"><h2 id="ph-journal-title"><BookOpenText size={18} /> Your journal</h2><Link href={PORTAL_JOURNAL}>Open journal <ArrowRight size={14} /></Link></div>
              {recentJournal.length ? <div className="ph-journal-list">{recentJournal.map((entry) => <article key={entry.id}><span>{dateTime(String(entry.entry_date ?? entry.created_at ?? ""))}</span><strong>{text(entry.mood, "Reflection").replaceAll("_", " ")}</strong><p>{text(entry.entry_text, "Journal entry")}</p></article>)}</div>
                : <div className="ph-empty"><p>You haven't written a journal entry yet.</p><Link href={PORTAL_JOURNAL}>Start your journal <ArrowRight size={14} /></Link></div>}
            </section>

            <section className="ph-panel" id="documents" aria-labelledby="ph-documents-title">
              <div className="ph-panel-heading"><h2 id="ph-documents-title"><FileText size={18} /> Forms & documents</h2><span>{data.documents.length} on file</span></div>
              {data.documents.length ? <div className="ph-document-list">{data.documents.map((doc) => <div key={doc.id}><span className="ph-doc-icon"><FileText size={16} /></span><div><strong>{text(doc.file_name, "Patient document")}</strong><small>{text(doc.document_type, "Document").replaceAll("_", " ")} · {dateTime(String(doc.created_at ?? ""))}</small></div></div>)}</div>
                : <div className="ph-empty"><p>No patient-facing documents are on file yet.</p></div>}
              <p className="ph-caption">This section shows document details. Contact your practice for a copy of a document.</p>
            </section>
          </div>

          <section className="ph-panel ph-profile" id="profile" aria-labelledby="ph-profile-title">
            <div className="ph-panel-heading"><h2 id="ph-profile-title"><UserRound size={18} /> My information</h2><span>Contact your practice to request changes</span></div>
            <div className="ph-profile-fields">
              <div><small>Preferred name</small><strong>{patientDisplayName}</strong></div>
              <div><small>Date of birth</small><strong>{text(data.patient.date_of_birth)}</strong></div>
              <div><small>Email</small><strong>{text(data.patient.email)}</strong></div>
              <div><small>Phone</small><strong>{text(data.patient.phone)}</strong></div>
            </div>
          </section>
        </main>

        <aside className="pj-rightbar ph-rightbar" aria-label="Care and account summary">
          <section className="pj-side-card ph-side">
            <h2><Heart size={17} /> Your care team</h2>
            <div className="pj-provider"><span className="pj-provider-avatar" aria-hidden="true"><Heart size={20} /></span><div><strong>{providerName(data.provider)}</strong><small>{data.providerUnavailable ? "Care team details are temporarily unavailable" : "Here to support your care"}</small></div></div>
          </section>
          <section className="pj-side-card ph-side">
            <h2><ShieldCheck size={17} /> Insurance on file</h2>
            <strong className="ph-side-number">{activeCoverage.length} active {activeCoverage.length === 1 ? "plan" : "plans"}</strong>
            {activeCoverage.length ? <p>{activeCoverage.map((p) => text(p.insurance_order, "Coverage").replaceAll("_", " ")).join(", ")}</p> : <p>No active insurance coverage is shown.</p>}
          </section>
          <section className="pj-side-card ph-side" id="billing">
            <h2><CreditCard size={17} /> Account balance</h2>
            <strong className="ph-balance">{money(data.openBalanceCents)}</strong>
            <p>Balance shown is based on posted transactions. Contact your practice with billing questions.</p>
          </section>
          <div className="ph-help"><ShieldCheck size={18} /><p>For urgent medical concerns or an emergency, use local emergency services. This portal is not monitored for emergencies.</p></div>
        </aside>
      </div>
    </div>
  );
}


function appointmentStatus(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = { scheduled: "Scheduled", confirmed: "Confirmed", client_on_my_way: "On my way", client_arrived: "Arrived", checked_in: "Checked in" };
  return labels[status] ?? (status ? status.replaceAll("_", " ") : "Status unavailable");
}

function ArrivalActions({ appointment, checkin, working, checkIn }: {
  appointment: PortalData["upcomingAppointments"][number];
  checkin: PortalData["checkins"][number] | null | undefined;
  working: string | null;
  checkIn: (id: string, step: "on_my_way" | "arrived" | "checked_in") => Promise<void>;
}) {
  const checkedIn = Boolean(checkin?.checked_in_at) || appointment.appointment_status === "checked_in";
  const arrived = checkedIn || Boolean(checkin?.arrived_at) || appointment.appointment_status === "client_arrived";
  const onMyWay = arrived || Boolean(checkin?.on_my_way_at) || appointment.appointment_status === "client_on_my_way";
  return <div className="ph-arrival" role="group" aria-label={`Arrival for ${dateTime(String(appointment.starts_at))}`}>
    <span>Arrival at the practice</span>
    <div>{([
      ["on_my_way", "On my way", onMyWay], ["arrived", "I arrived", arrived], ["checked_in", "Check in", checkedIn],
    ] as const).map(([step, label, complete]) => <button key={step} type="button" disabled={complete || working !== null} onClick={() => void checkIn(appointment.id, step)}>{label}{complete ? " ✓" : working === `${appointment.id}-${step}` ? " — Saving…" : ""}</button>)}</div>
  </div>;
}
