import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link, useRoute } from "wouter";

import { getPatientPortalData, savePreVisitCheckIn } from "./repository";
import type { PreVisitCheckInUpdate } from "./workflow";
import "./patient-journal.css";
import "./patient-checkin.css";

type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;

type VisitQuestions = {
  focus_today: string;
  feeling_since_last_visit: string;
  important_changes: string;
  safety_concerns: string;
  treatment_goal: string;
  anything_else: string;
};

type Consents = {
  information_accurate: boolean;
  privacy_acknowledged: boolean;
  care_acknowledged: boolean;
};

const emptyQuestions: VisitQuestions = {
  focus_today: "",
  feeling_since_last_visit: "",
  important_changes: "",
  safety_concerns: "",
  treatment_goal: "",
  anything_else: "",
};

const emptyConsents: Consents = {
  information_accurate: false,
  privacy_acknowledged: false,
  care_acknowledged: false,
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function patientName(row: Record<string, unknown>) {
  const preferred = String(row.preferred_name ?? "").trim();
  return [preferred || row.first_name, row.last_name].filter(Boolean).join(" ") || "Patient";
}

function firstName(row: Record<string, unknown>) {
  return String(row.preferred_name ?? row.first_name ?? "Patient");
}

function formatDate(value: unknown, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, options ?? { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function readQuestions(value: unknown): VisitQuestions {
  const row = recordOf(value);
  return {
    focus_today: String(row.focus_today ?? ""),
    feeling_since_last_visit: String(row.feeling_since_last_visit ?? ""),
    important_changes: String(row.important_changes ?? ""),
    safety_concerns: String(row.safety_concerns ?? ""),
    treatment_goal: String(row.treatment_goal ?? ""),
    anything_else: String(row.anything_else ?? ""),
  };
}

function readConsents(value: unknown): Consents {
  const row = recordOf(value);
  return {
    information_accurate: row.information_accurate === true,
    privacy_acknowledged: row.privacy_acknowledged === true,
    care_acknowledged: row.care_acknowledged === true,
  };
}

export function PatientCheckInPage() {
  const [, params] = useRoute<{ clientId: string; appointmentId: string }>("/patient-portal/:clientId/check-in/:appointmentId");
  const clientId = params?.clientId ?? "";
  const appointmentId = params?.appointmentId ?? "";
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [demographicsConfirmed, setDemographicsConfirmed] = useState(false);
  const [insuranceConfirmed, setInsuranceConfirmed] = useState(false);
  const [visitQuestions, setVisitQuestions] = useState<VisitQuestions>(emptyQuestions);
  const [consents, setConsents] = useState<Consents>(emptyConsents);
  const [submittedAt, setSubmittedAt] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!clientId || !appointmentId) return;
      setLoading(true);
      try {
        const result = await getPatientPortalData(clientId);
        if (!active) return;
        const appointment = result.upcomingAppointments.find((row) => row.id === appointmentId);
        if (!appointment) throw new Error("This appointment is not available for pre-visit check-in.");
        const checkin = result.checkins.find((row) => String(row.appointment_id ?? "") === appointmentId);
        const preVisit = recordOf(recordOf(checkin?.responses).pre_visit);
        const demographicsDone = preVisit.demographics_confirmed === true;
        const insuranceDone = preVisit.insurance_confirmed === true;
        const loadedQuestions = readQuestions(preVisit.visit_questions);
        const loadedConsents = readConsents(preVisit.consents);
        const submitted = String(preVisit.submitted_at ?? "");

        setData(result);
        setDemographicsConfirmed(demographicsDone);
        setInsuranceConfirmed(insuranceDone);
        setVisitQuestions(loadedQuestions);
        setConsents(loadedConsents);
        setSubmittedAt(submitted);
        setActiveStep(submitted ? 5 : !demographicsDone ? 1 : !insuranceDone ? 2 : 3);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load pre-visit check-in.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [appointmentId, clientId]);

  const appointment = data?.upcomingAppointments.find((row) => row.id === appointmentId) ?? null;
  const policy = data?.insurancePolicies.find((row) => String(row.status ?? "") === "active") ?? data?.insurancePolicies[0] ?? null;
  const allConsentsAccepted = Object.values(consents).every(Boolean);
  const hasVisitAnswers = useMemo(
    () => Object.values(visitQuestions).some((value) => value.trim().length > 0),
    [visitQuestions],
  );

  async function persist(label: string, update: PreVisitCheckInUpdate) {
    setWorking(label);
    setError(null);
    setNotice(null);
    try {
      const saved = await savePreVisitCheckIn(appointmentId, clientId, update);
      const preVisit = recordOf(recordOf(saved.responses).pre_visit);
      if (preVisit.submitted_at) setSubmittedAt(String(preVisit.submitted_at));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save pre-visit check-in.");
      return false;
    } finally {
      setWorking(null);
    }
  }

  async function confirmDemographics() {
    if (await persist("demographics", { demographics_confirmed: true })) {
      setDemographicsConfirmed(true);
      setActiveStep(2);
      setNotice("Demographics confirmed.");
    }
  }

  async function confirmInsurance() {
    if (await persist("insurance", { insurance_confirmed: true })) {
      setInsuranceConfirmed(true);
      setActiveStep(3);
      setNotice("Insurance information confirmed.");
    }
  }

  async function saveVisitQuestions() {
    if (await persist("questions", { visit_questions: visitQuestions })) {
      setActiveStep(4);
      setNotice("Visit questions saved.");
    }
  }

  async function saveConsents() {
    if (await persist("consents", { consents })) {
      setActiveStep(5);
      setNotice("Consents saved.");
    }
  }

  async function submitCheckIn() {
    if (!demographicsConfirmed || !insuranceConfirmed || !allConsentsAccepted) {
      setError("Complete demographics, insurance, and all acknowledgments before submitting.");
      return;
    }
    if (await persist("submit", {
      visit_questions: visitQuestions,
      consents,
      demographics_confirmed: true,
      insurance_confirmed: true,
      submitted: true,
    })) {
      setActiveStep(5);
      setNotice("Pre-visit check-in submitted.");
    }
  }

  if (loading) return <div className="pj-loading">Loading pre-visit check-in...</div>;
  if (!data || !appointment) return <div className="pj-loading pj-error">{error ?? "Pre-visit check-in is unavailable."}</div>;

  const patientDisplayName = patientName(data.patient);
  const stepStatuses = [
    demographicsConfirmed,
    insuranceConfirmed,
    hasVisitAnswers,
    allConsentsAccepted,
    Boolean(submittedAt),
  ];

  return (
    <div className="pj-app">
      <header className="pj-topbar">
        <Link href={`/patient-portal/${clientId}`} className="pj-brand" aria-label="Therassistant patient portal home">
          <span className="pj-logo-mark" aria-hidden="true"><span>▲</span><span>▲</span><span>▲</span></span>
          <span><strong>THERASSISTANT EHR</strong><small>BEHAVIORAL HEALTH. A BRIGHTER TOMORROW.</small></span>
        </Link>
        <div className="pj-topbar-right">
          <span className="pj-care-message">Care today. A healthier tomorrow.</span>
          <span className="pj-avatar">{firstName(data.patient).slice(0, 1).toUpperCase()}</span>
          <span className="pj-user"><strong>{patientDisplayName}</strong><small>Patient Portal</small></span>
        </div>
      </header>

      <div className="pj-layout pci-layout">
        <aside className="pj-sidebar">
          <div className="pj-welcome"><small>Welcome back,</small><strong>{firstName(data.patient)}</strong></div>
          <div className="pj-mountains" aria-hidden="true">⌁⌁⌁</div>
          <p className="pj-progress-copy">Progress happens<br />between sessions, too.</p>
          <nav className="pj-nav" aria-label="Patient portal navigation">
            <Link href={`/patient-portal/${clientId}`}><Home size={17} /> Home</Link>
            <Link href={`/patient-portal/${clientId}`}><CalendarDays size={17} /> Appointments</Link>
            <Link href={`/patient-portal/${clientId}/journal`}><ClipboardCheck size={17} /> Journal</Link>
            <Link href={`/patient-portal/${clientId}/check-in/${appointmentId}`} className="active"><Heart size={17} /> Check-In</Link>
            <Link href={`/patient-portal/${clientId}`}><CreditCard size={17} /> Billing</Link>
            <Link href={`/patient-portal/${clientId}`}><MessageSquare size={17} /> Messages</Link>
            <Link href={`/patient-portal/${clientId}`}><UserRound size={17} /> Profile</Link>
          </nav>
          <div className="pj-sidebar-quote"><div className="pj-tree-line">▲ ▲ ▲</div><em>Same people.<br />A Healthier You.</em></div>
        </aside>

        <main className="pci-main">
          <div className="pj-breadcrumb"><span>Check-In</span><span>›</span><strong>Pre-Visit Check-In</strong></div>
          <div className="pj-title-row pci-title-row">
            <div><h1>Pre-Visit Check-In</h1><p>Take a few minutes to complete your check-in before your appointment.</p></div>
            <div className="pj-hand-note">Small steps<br />lead to meaningful<br />change. ♡</div>
          </div>

          {error && <div className="pj-message error">{error}</div>}
          {notice && <div className="pj-message success"><CheckCircle2 size={16} /> {notice}</div>}

          <section className="pci-appointment-card">
            <div className="pci-appointment-block"><CalendarDays size={22} /><div><strong>{formatDate(appointment.starts_at)}</strong><span>{formatTime(appointment.starts_at)} – {formatTime(appointment.ends_at)}</span></div></div>
            <div className="pci-appointment-block"><Heart size={20} /><div><strong>{String(appointment.service_type ?? "Individual Therapy")}</strong><span>{String(appointment.location_type ?? "Office").replaceAll("_", " ")}</span></div></div>
            <div className="pci-appointment-block"><MapPin size={20} /><div><strong>Appointment location</strong><span>{String(appointment.location_type ?? "Office").replaceAll("_", " ")}</span></div></div>
          </section>

          <div className="pci-progress" aria-label="Check-in progress">
            {["Demographics", "Insurance", "Visit Questions", "Consents", "Review & Submit"].map((label, index) => {
              const step = index + 1;
              const complete = stepStatuses[index];
              return <button type="button" key={label} className={activeStep === step ? "active" : ""} onClick={() => setActiveStep(step)}>
                <span className={complete ? "complete" : activeStep === step ? "current" : ""}>{complete ? <Check size={14} /> : step}</span>
                <small>{label}</small>
              </button>;
            })}
          </div>

          <section className={`pci-section ${activeStep === 1 ? "open" : ""}`}>
            <button type="button" className="pci-section-header" onClick={() => setActiveStep(1)}>
              <span className={`pci-status-dot ${demographicsConfirmed ? "complete" : ""}`}>{demographicsConfirmed ? <Check size={14} /> : 1}</span>
              <strong>Demographics</strong><span className="pci-section-state">{demographicsConfirmed ? "Completed" : "Confirm information"}</span><ChevronDown size={16} />
            </button>
            {activeStep === 1 && <div className="pci-section-body">
              <div className="pci-summary-grid">
                <Summary label="Name" value={patientDisplayName} />
                <Summary label="Date of birth" value={String(data.patient.date_of_birth ?? "—")} />
                <Summary label="Phone" value={String(data.patient.phone ?? "—")} />
                <Summary label="Email" value={String(data.patient.email ?? "—")} />
                <Summary label="Address" value={[data.patient.address_line1, data.patient.address_line2, data.patient.city, data.patient.state, data.patient.postal_code].filter(Boolean).join(", ") || "—"} wide />
              </div>
              <div className="pci-actions"><button type="button" className="pj-primary-button" disabled={working !== null} onClick={() => void confirmDemographics()}>{working === "demographics" ? "Saving..." : demographicsConfirmed ? "Confirmed" : "Confirm Demographics"}</button></div>
            </div>}
          </section>

          <section className={`pci-section ${activeStep === 2 ? "open" : ""}`}>
            <button type="button" className="pci-section-header" onClick={() => setActiveStep(2)}>
              <span className={`pci-status-dot ${insuranceConfirmed ? "complete" : ""}`}>{insuranceConfirmed ? <Check size={14} /> : 2}</span>
              <strong>Insurance</strong><span className="pci-section-state">{insuranceConfirmed ? "Completed" : "Confirm coverage"}</span><ChevronDown size={16} />
            </button>
            {activeStep === 2 && <div className="pci-section-body">
              {policy ? <div className="pci-summary-grid">
                <Summary label="Coverage" value={String(policy.insurance_order ?? "Primary").replaceAll("_", " ")} />
                <Summary label="Member ID" value={String(policy.member_id ?? "—")} />
                <Summary label="Group number" value={String(policy.group_number ?? "—")} />
                <Summary label="Status" value={String(policy.status ?? "—")} />
              </div> : <div className="pci-empty">No insurance policy is currently shown in the portal.</div>}
              <div className="pci-actions"><button type="button" className="pj-primary-button" disabled={working !== null} onClick={() => void confirmInsurance()}>{working === "insurance" ? "Saving..." : insuranceConfirmed ? "Confirmed" : "Confirm Insurance"}</button></div>
            </div>}
          </section>

          <section className={`pci-section ${activeStep === 3 ? "open" : ""}`}>
            <button type="button" className="pci-section-header" onClick={() => setActiveStep(3)}>
              <span className={`pci-status-dot ${hasVisitAnswers ? "complete" : "current"}`}>{hasVisitAnswers ? <Check size={14} /> : 3}</span>
              <strong>Visit Questions</strong><span className="pci-section-state">{hasVisitAnswers ? "In progress" : "Not started"}</span><ChevronDown size={16} />
            </button>
            {activeStep === 3 && <div className="pci-section-body pci-questions">
              <Question label="What would you like to focus on today?" value={visitQuestions.focus_today} onChange={(value) => setVisitQuestions((current) => ({ ...current, focus_today: value }))} />
              <Question label="How have you been feeling since your last visit?" value={visitQuestions.feeling_since_last_visit} onChange={(value) => setVisitQuestions((current) => ({ ...current, feeling_since_last_visit: value }))} />
              <Question label="Any important changes since your last appointment?" value={visitQuestions.important_changes} onChange={(value) => setVisitQuestions((current) => ({ ...current, important_changes: value }))} />
              <Question label="Are there any safety concerns you want your provider to know about today?" value={visitQuestions.safety_concerns} onChange={(value) => setVisitQuestions((current) => ({ ...current, safety_concerns: value }))} />
              <label className="pci-question"><span><ShieldCheck size={17} /> Which treatment goal feels most important right now?</span><select value={visitQuestions.treatment_goal} onChange={(event) => setVisitQuestions((current) => ({ ...current, treatment_goal: event.target.value }))}><option value="">Select a treatment goal</option>{data.treatmentGoals.map((goal) => <option key={goal.id} value={String(goal.goal_text ?? goal.id)}>{String(goal.goal_text ?? "Treatment goal")}</option>)}</select></label>
              <Question label="Anything else you want your provider to know before the session?" value={visitQuestions.anything_else} onChange={(value) => setVisitQuestions((current) => ({ ...current, anything_else: value }))} />
              <div className="pci-actions"><button type="button" className="pj-primary-button" disabled={working !== null} onClick={() => void saveVisitQuestions()}>{working === "questions" ? "Saving..." : "Save & Continue"}</button></div>
            </div>}
          </section>

          <section className={`pci-section ${activeStep === 4 ? "open" : ""}`}>
            <button type="button" className="pci-section-header" onClick={() => setActiveStep(4)}>
              <span className={`pci-status-dot ${allConsentsAccepted ? "complete" : ""}`}>{allConsentsAccepted ? <Check size={14} /> : 4}</span>
              <strong>Consents & Acknowledgments</strong><span className="pci-section-state">{allConsentsAccepted ? "Completed" : "Not started"}</span><ChevronDown size={16} />
            </button>
            {activeStep === 4 && <div className="pci-section-body">
              <Consent checked={consents.information_accurate} onChange={(checked) => setConsents((current) => ({ ...current, information_accurate: checked }))}>I confirm that my demographic and insurance information shown above is accurate to the best of my knowledge.</Consent>
              <Consent checked={consents.privacy_acknowledged} onChange={(checked) => setConsents((current) => ({ ...current, privacy_acknowledged: checked }))}>I acknowledge the practice privacy and communication policies already available in my portal.</Consent>
              <Consent checked={consents.care_acknowledged} onChange={(checked) => setConsents((current) => ({ ...current, care_acknowledged: checked }))}>I understand that this pre-visit check-in supports, but does not replace, discussion with my provider.</Consent>
              <div className="pci-actions"><button type="button" className="pj-primary-button" disabled={working !== null} onClick={() => void saveConsents()}>{working === "consents" ? "Saving..." : "Save & Continue"}</button></div>
            </div>}
          </section>

          <section className={`pci-section ${activeStep === 5 ? "open" : ""}`}>
            <button type="button" className="pci-section-header" onClick={() => setActiveStep(5)}>
              <span className={`pci-status-dot ${submittedAt ? "complete" : ""}`}>{submittedAt ? <Check size={14} /> : 5}</span>
              <strong>Review & Submit</strong><span className="pci-section-state">{submittedAt ? `Submitted ${formatDate(submittedAt)}` : "Not started"}</span><ChevronDown size={16} />
            </button>
            {activeStep === 5 && <div className="pci-section-body">
              <div className="pci-review-banner"><FileCheck2 size={20} /><div><strong>{submittedAt ? "Your pre-visit check-in has been submitted." : "Review your check-in before submitting."}</strong><span>Your provider will be able to review these responses in the appointment context.</span></div></div>
              <div className="pci-review-list">
                <ReviewItem label="Demographics" complete={demographicsConfirmed} />
                <ReviewItem label="Insurance" complete={insuranceConfirmed} />
                <ReviewItem label="Visit Questions" complete={hasVisitAnswers} />
                <ReviewItem label="Consents & Acknowledgments" complete={allConsentsAccepted} />
              </div>
              <div className="pci-actions"><button type="button" className="pj-primary-button" disabled={working !== null || Boolean(submittedAt)} onClick={() => void submitCheckIn()}>{working === "submit" ? "Submitting..." : submittedAt ? "Submitted" : "Submit Pre-Visit Check-In"}</button></div>
            </div>}
          </section>
        </main>
      </div>
    </div>
  );
}

function Summary({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "pci-summary wide" : "pci-summary"}><small>{label}</small><strong>{value}</strong></div>;
}

function Question({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="pci-question"><span><MessageSquare size={17} /> {label}</span><textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Consent({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: string }) {
  return <label className="pci-consent"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{children}</span></label>;
}

function ReviewItem({ label, complete }: { label: string; complete: boolean }) {
  return <div className="pci-review-item"><span className={complete ? "complete" : ""}>{complete ? <CheckCircle2 size={15} /> : <span className="pci-review-empty" />}</span><strong>{label}</strong><small>{complete ? "Complete" : "Needs attention"}</small></div>;
}
