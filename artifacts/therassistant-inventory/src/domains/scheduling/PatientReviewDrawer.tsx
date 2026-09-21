import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  BookOpenText,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  FileText,
  Flag,
  ShieldCheck,
  Target,
} from "lucide-react";

import { StatusBadge } from "../../components/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { shortDate } from "../../lib/format";
import { startEncounter } from "../encounters/repository";
import { getPatientChart } from "../patients/repository";
import type { PatientChart, PatientChartRow } from "../patients/types";
import { buildPatientReviewCheckIn } from "./patient-review-model";
import type { ScheduleAppointment } from "./repository";
import "./patient-review-drawer.css";

type Props = {
  appointment: ScheduleAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditAppointment?: () => void;
};

type AnyRow = Record<string, unknown>;

function text(row: AnyRow | null | undefined, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function ageOn(dob: string) {
  const birth = new Date(dob);
  if (!Number.isFinite(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const month = today.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function initials(row: AnyRow | null | undefined) {
  const first = text(row, ["preferred_name", "first_name"]);
  const last = text(row, ["last_name"]);
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "PT";
}

function timeLabel(startsAt: string) {
  const value = new Date(startsAt);
  return Number.isFinite(value.getTime())
    ? value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "—";
}

function durationMinutes(appointment: ScheduleAppointment) {
  const start = new Date(appointment.startsAt).getTime();
  const end = new Date(appointment.endsAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60000)) : 0;
}

function rowDate(row?: AnyRow | null) {
  const value = text(row, ["entry_date", "service_date", "created_at"]);
  return value ? shortDate(value) : "—";
}

export function PatientReviewDrawer({ appointment, open, onOpenChange, onEditAppointment }: Props) {
  const [, navigate] = useLocation();
  const [chart, setChart] = useState<PatientChart | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !appointment) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPatientChart(appointment.clientId)
      .then((next) => { if (!cancelled) setChart(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load patient review."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, appointment?.id, appointment?.clientId]);

  const review = useMemo(() => {
    if (!chart || !appointment) return null;
    const checkin = chart.checkins.find((row) => String(row.appointment_id ?? "") === appointment.id) ?? chart.checkins[0] ?? null;
    const patientUpdate = buildPatientReviewCheckIn(checkin);
    const journal = chart.journalEntries.find((row) =>
      String(row.visibility ?? "") === "shared_with_provider" &&
      String(row.entry_status ?? "submitted") !== "draft"
    ) ?? null;
    const plan = chart.treatmentPlans.find((row) => ["active", "signed"].includes(String(row.status ?? ""))) ?? chart.treatmentPlans[0] ?? null;
    const goal = plan?.goals?.[0] ?? null;
    const priorNote = chart.clinicalNotes.find((row) => ["signed", "locked"].includes(String(row.note_status ?? ""))) ?? chart.clinicalNotes[0] ?? null;
    const focus = patientUpdate.focus || text(goal, ["goal_text", "description", "goal", "title"], "Review current treatment priorities.");
    const mood = patientUpdate.mood || "No mood update submitted.";
    const goalText = patientUpdate.treatmentGoal || text(goal, ["goal_text", "description", "goal", "title"], "No active goal documented.");
    const targetDate = text(goal, ["target_date", "target_completion_date", "review_due_date"]);
    const goalStatus = patientUpdate.treatmentGoal
      ? "Patient update"
      : text(goal, ["goal_status", "status"], "Active").replaceAll("_", " ");
    const priorPlan = text(priorNote, ["plan", "plan_text", "assessment_plan", "next_steps", "follow_up_plan"], "No prior session plan documented.");
    return {
      checkin,
      journal,
      focus,
      mood,
      changes: patientUpdate.changes,
      additionalContext: patientUpdate.additionalContext,
      goalText,
      targetDate,
      goalStatus,
      priorPlan,
      safety: patientUpdate.safetyConcern,
      safetyText: patientUpdate.safetyText,
      hasSubmittedPreVisit: patientUpdate.hasSubmittedPreVisit,
    };
  }, [chart, appointment]);

  async function startNote() {
    if (!appointment) return;
    setStarting(true);
    setError(null);
    try {
      const result = await startEncounter(appointment.id);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      navigate(`/encounters/${result.value.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start note.");
    } finally {
      setStarting(false);
    }
  }

  if (!appointment) return null;
  const patient = chart?.patient ?? null;
  const dob = text(patient, ["date_of_birth"]);
  const age = dob ? ageOn(dob) : null;
  const pronouns = text(patient, ["pronouns", "preferred_pronouns"]);
  const payerAttention = appointment.readiness.checks.filter((check) => check.status !== "pass");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="patient-review-drawer">
        <div className="patient-review-scroll">
          <SheetHeader className="patient-review-heading">
            <SheetTitle>Patient Review</SheetTitle>
            <SheetDescription>Pre-session details and key information.</SheetDescription>
          </SheetHeader>

          <section className="patient-review-person-card">
            <div className="patient-review-avatar">{initials(patient)}</div>
            <div className="patient-review-person-main">
              <strong>{appointment.clientName}{pronouns ? <span className="patient-review-pronouns"> ({pronouns})</span> : null}</strong>
              <span>{dob ? `DOB: ${shortDate(dob)}${age !== null ? ` (Age ${age})` : ""}` : "DOB not recorded"}</span>
            </div>
            <div className="patient-review-appointment">
              <strong>{timeLabel(appointment.startsAt)}</strong>
              <span>{durationMinutes(appointment)} min · {appointment.serviceType || "Appointment"}</span>
              <StatusBadge value={appointment.appointmentStatus} />
            </div>
          </section>

          {error ? <div className="patient-review-error">{error}</div> : null}
          {loading && !review ? <div className="thera-state">Loading patient review...</div> : null}

          {review ? <div className="patient-review-sections">
            <ReviewSection icon={<ClipboardList size={15} />} title="Check-In Summary" action={onEditAppointment ? <button type="button" onClick={onEditAppointment}>Edit</button> : null}>
              <Definition label="Focus Today" value={review.focus} />
              <Definition label="Patient's Mood" value={review.mood} />
              <div className="patient-review-definition"><span>Recent Changes</span>{review.changes.length ? <ul>{review.changes.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No recent changes submitted.</p>}</div>
              {review.additionalContext ? <Definition label="Additional Context" value={review.additionalContext} /> : null}
            </ReviewSection>

            <ReviewSection icon={<BookOpenText size={15} />} title="Journal Review" action={<button type="button" onClick={() => navigate(`/clients/${appointment.clientId}`)}>View All</button>}>
              {review.journal ? <><div className="patient-review-inline-meta"><span>{rowDate(review.journal)}</span><span className="patient-review-shared"><CircleDot size={11} /> Shared by Patient</span></div><p className="patient-review-quote">“{text(review.journal, ["entry_text"], "Journal entry available.")}”</p></> : <p className="patient-review-muted">No journal entry shared for review.</p>}
            </ReviewSection>

            <ReviewSection icon={<Target size={15} />} title="Session Focus">
              <div className="patient-review-highlight positive"><Target size={18} /><div><strong>WORK ON</strong><p>{review.focus}</p></div></div>
            </ReviewSection>

            <ReviewSection icon={<Flag size={15} />} title="Active Goal" action={<button type="button" onClick={() => navigate(`/clients/${appointment.clientId}`)}>View Goals</button>}>
              <p className="patient-review-goal">{review.goalText}</p>
              <div className="patient-review-inline-meta"><span>{review.targetDate ? `Target date: ${shortDate(review.targetDate)}` : "No target date"}</span><span className="patient-review-shared"><CircleDot size={11} /> {review.goalStatus}</span></div>
            </ReviewSection>

            <ReviewSection icon={<FileText size={15} />} title="Prior Session Plan">
              <p>{review.priorPlan}</p>
            </ReviewSection>

            <ReviewSection icon={<ShieldCheck size={15} />} title="Safety Review">
              <div className={`patient-review-highlight ${review.safety === true ? "warning" : "positive"}`}><CheckCircle2 size={18} /><div><strong>{review.safety === true ? "Safety concern documented" : review.safety === false ? "No safety concerns" : "Safety review not submitted"}</strong><p>{review.safetyText ? review.safetyText : review.safety === true ? "Review the documented risk information before the session." : review.safety === false ? "No risk factors reported in the latest check-in." : "Review available chart information before the session."}</p></div></div>
            </ReviewSection>

            <ReviewSection icon={<CheckCircle2 size={15} />} title="Payer / Billing Readiness">
              <div className={`patient-review-highlight ${payerAttention.length ? "warning" : "positive"}`}><CheckCircle2 size={18} /><div><strong>{payerAttention.length ? "Administrative follow-up needed" : "Payer checks complete"}</strong><p>{payerAttention.length ? `${payerAttention.length} payer or billing item${payerAttention.length === 1 ? "" : "s"} need attention. They do not prevent starting the encounter or documenting care.` : "Current payer-readiness checks are complete."}</p></div></div>
            </ReviewSection>
          </div> : null}
        </div>

        <footer className="patient-review-footer">
          <button type="button" className="patient-review-secondary" onClick={() => navigate(`/clients/${appointment.clientId}`)}><BookOpenText size={16} /> Open Chart</button>
          <button type="button" className="patient-review-primary" disabled={starting} onClick={() => void startNote()}><FileText size={16} /> {starting ? "Starting..." : "Start Note"}</button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function ReviewSection({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="patient-review-section"><div className="patient-review-section-title"><span>{icon}</span><strong>{title}</strong><div>{action}</div></div><div className="patient-review-section-body">{children}</div></section>;
}

function Definition({ label, value }: { label: string; value: string }) {
  return <div className="patient-review-definition"><span>{label}</span><p>{value}</p></div>;
}
