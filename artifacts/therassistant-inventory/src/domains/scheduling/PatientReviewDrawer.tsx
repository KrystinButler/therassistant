import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { dateTime, shortDate } from "../../lib/format";
import type { ScheduleAppointment } from "./repository";
import "./schedule-workspace.css";

type PatientReviewDrawerProps = {
  appointment: ScheduleAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChart: () => void;
  onStartEncounter: () => Promise<void>;
  startingEncounter: boolean;
  error?: string | null;
};

function effectiveCheckInStatus(appointment: ScheduleAppointment) {
  if (["checked_in", "in_session"].includes(appointment.appointmentStatus)) {
    return "Ready";
  }
  return appointment.patientReview.checkInStatus;
}

export function PatientReviewDrawer({
  appointment,
  open,
  onOpenChange,
  onOpenChart,
  onStartEncounter,
  startingEncounter,
  error,
}: PatientReviewDrawerProps) {
  if (!appointment) return null;

  const review = appointment.patientReview;
  const responses = review.checkInResponses;
  const checkInStatus = effectiveCheckInStatus(appointment);

  return (
    <WorkDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Patient Review"
      subtitle={`${appointment.clientName}${appointment.clientPronouns ? ` (${appointment.clientPronouns})` : ""} · ${dateTime(appointment.startsAt)} · ${appointment.serviceType || "Session"}`}
      badges={
        <>
          <StatusBadge value={checkInStatus} />
          <StatusBadge value={appointment.appointmentStatus} />
        </>
      }
      footer={
        <div className="schedule-review-footer">
          <button type="button" className="thera-action secondary" onClick={onOpenChart}>
            Open Chart
          </button>
          <button
            type="button"
            className="thera-action"
            disabled={startingEncounter}
            onClick={() => void onStartEncounter()}
          >
            {startingEncounter ? "Starting..." : "Start Note"}
          </button>
        </div>
      }
    >
      <div className="schedule-review-stack">
        <section className="schedule-review-card">
          <div className="schedule-review-card-header">
            <h3>Check-In Summary</h3>
            <StatusBadge value={checkInStatus} />
          </div>
          <dl className="schedule-review-list">
            <div><dt>Focus Today</dt><dd>{responses.focusToday ?? "No focus submitted."}</dd></div>
            <div><dt>Patient Mood</dt><dd>{responses.moodSinceLastVisit ?? "No mood update submitted."}</dd></div>
            <div><dt>Recent Changes</dt><dd>{responses.recentChanges ?? "No recent changes submitted."}</dd></div>
            <div><dt>Message for Provider</dt><dd>{responses.providerMessage ?? "No additional message."}</dd></div>
          </dl>
        </section>

        <section className="schedule-review-card">
          <div className="schedule-review-card-header">
            <h3>Journal Review</h3>
            {review.latestSharedJournal ? <span className="schedule-patient-source">Patient submitted</span> : null}
          </div>
          {review.latestSharedJournal ? (
            <div className="schedule-journal-preview">
              <div className="schedule-review-meta">
                {shortDate(review.latestSharedJournal.createdAt)}
                {review.latestSharedJournal.mood ? ` · ${review.latestSharedJournal.mood}` : ""}
              </div>
              <p>{review.latestSharedJournal.text}</p>
            </div>
          ) : (
            <p className="schedule-review-empty">No shared journal entry for this visit.</p>
          )}
        </section>

        <section className="schedule-review-card schedule-review-focus">
          <h3>Session Focus</h3>
          <p>{review.sessionFocus}</p>
        </section>

        <section className="schedule-review-card">
          <div className="schedule-review-card-header"><h3>Active Goal</h3></div>
          {review.activeGoal ? (
            <div>
              <p>{review.activeGoal.text}</p>
              <div className="schedule-review-meta">
                <StatusBadge value={review.activeGoal.status} />
                {review.activeGoal.targetDate ? <span>Target {shortDate(review.activeGoal.targetDate)}</span> : null}
              </div>
            </div>
          ) : (
            <p className="schedule-review-empty">No active treatment goal is linked.</p>
          )}
        </section>

        <section className="schedule-review-card">
          <h3>Prior Session Plan</h3>
          <p>{review.priorSessionPlan ?? "No prior-session plan is available."}</p>
        </section>

        <section className={`schedule-review-card ${review.hasSafetyConcern ? "schedule-safety-alert" : "schedule-safety-clear"}`}>
          <div className="schedule-review-card-header">
            <h3>Safety Review</h3>
            <StatusBadge value={review.hasSafetyConcern ? "urgent" : "clear"} />
          </div>
          <p>{review.safetySummary}</p>
        </section>

        <section className="schedule-review-card">
          <div className="schedule-review-card-header">
            <h3>Visit Readiness</h3>
            <StatusBadge value={appointment.readiness.ready ? "ready" : "blocked"} />
          </div>
          <div className="schedule-readiness-list">
            {appointment.readiness.checks.map((check) => (
              <div className="schedule-readiness-item" key={check.code}>
                <StatusBadge value={check.status} />
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.message}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {error ? <div className="thera-state error">{error}</div> : null}
      </div>
    </WorkDrawer>
  );
}
