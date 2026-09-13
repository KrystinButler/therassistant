import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import {
  getPreSessionData,
  runEligibility,
  type ScheduleAppointment,
} from "./repository";

export function PreSessionPage() {
  const [, params] = useRoute<{ id: string }>("/schedule/:id");
  const appointmentId = params?.id ?? "";
  const [appointment, setAppointment] = useState<ScheduleAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningEligibility, setRunningEligibility] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!appointmentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPreSessionData(appointmentId);
      setAppointment(data.appointment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pre-session data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [appointmentId]);

  async function checkEligibility() {
    setRunningEligibility(true);
    setError(null);
    try {
      await runEligibility(appointmentId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run eligibility.");
    } finally {
      setRunningEligibility(false);
    }
  }

  if (loading) return <div className="thera-state">Loading pre-session readiness...</div>;
  if (error && !appointment) return <div className="thera-state error">{error}</div>;
  if (!appointment) return <div className="thera-state error">Appointment not found.</div>;

  const blocking = appointment.readiness.checks.filter((check) => check.blocking);

  return (
    <>
      <div className="thera-breadcrumb">
        <Link href="/schedule" className="thera-link">Schedule</Link>
        <span>/</span>
        <span>Pre-Session</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PRE-SESSION DASHBOARD</div>
          <h1>{appointment.clientName}</h1>
          <p>{dateTime(appointment.startsAt)} · {appointment.providerName} · {appointment.serviceType}</p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={appointment.appointmentStatus} />
          <StatusBadge value={appointment.readiness.ready ? "ready" : "blocked"} />
        </div>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="thera-detail-grid">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Appointment</h2><p>Clinical context before service begins.</p></div></div>
          <div className="thera-definition-grid">
            <Field label="Patient" value={appointment.clientName} />
            <Field label="Provider" value={appointment.providerName} />
            <Field label="Service" value={`${appointment.serviceType} ${appointment.cptCode ? `(${appointment.cptCode})` : ""}`} />
            <Field label="Location" value={appointment.locationType.replaceAll("_", " ")} />
            <Field label="Registration" value={<StatusBadge value={appointment.registrationStatus} />} />
          </div>
          <div style={{ marginTop: 14 }}><Link className="thera-link" href={`/clients/${appointment.clientId}`}>Open Patient Chart</Link></div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Insurance & Eligibility</h2><p>Coverage context is derived from the patient chart.</p></div></div>
          <div className="thera-definition-grid">
            <Field label="Payer" value={appointment.payerName} />
            <Field label="Plan" value={appointment.planName} />
            <Field label="Member ID" value={appointment.memberId || "—"} />
            <Field label="Eligibility" value={<StatusBadge value={appointment.eligibilityStatus || "not checked"} />} />
          </div>
          <div className="thera-filter-row" style={{ marginTop: 14 }}>
            <button type="button" className="thera-action" disabled={runningEligibility} onClick={() => void checkEligibility()}>
              {runningEligibility ? "Checking..." : "Run Eligibility"}
            </button>
            <Link className="thera-action secondary" href={`/clients/${appointment.clientId}`}>Manage Insurance</Link>
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Authorization</h2><p>Required units and approval status for the scheduled service.</p></div></div>
          <div className="thera-definition-grid">
            <Field label="Required" value={appointment.authorizationRequired ? "Yes" : "No"} />
            <Field label="Status" value={<StatusBadge value={appointment.authorizationStatus || (appointment.authorizationRequired ? "missing" : "not required")} />} />
            <Field label="Authorization #" value={appointment.authorizationNumber || "—"} />
            <Field label="Remaining Units" value={appointment.remainingUnits ?? "—"} />
          </div>
          <div style={{ marginTop: 14 }}><Link className="thera-link" href="/authorizations">Open Authorizations</Link></div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Provider Participation</h2><p>Billing eligibility for the scheduled payer.</p></div></div>
          <div className="thera-definition-grid">
            <Field label="Provider" value={appointment.providerName} />
            <Field label="Payer" value={appointment.payerName} />
            <Field label="Enrollment" value={<StatusBadge value={appointment.providerEnrollmentStatus || "not confirmed"} />} />
          </div>
          <div className="thera-filter-row" style={{ marginTop: 14 }}>
            {appointment.providerId && <Link className="thera-link" href={`/providers/${appointment.providerId}`}>Open Provider</Link>}
            <Link className="thera-link" href="/credentialing">Open Credentialing</Link>
          </div>
        </section>

        <section className="thera-card thera-span-2">
          <div className="thera-card-header">
            <div><h2>Readiness Audit</h2><p>{appointment.readiness.ready ? "All blocking prerequisites are satisfied." : `${blocking.length} blocking issue(s) must be resolved before the encounter starts.`}</p></div>
            <StatusBadge value={appointment.readiness.ready ? "ready" : "blocked"} />
          </div>
          <div className="thera-stack">
            {appointment.readiness.checks.map((check) => (
              <div className="thera-work-card" key={check.code}>
                <div className="thera-work-card-top">
                  <strong>{check.label}</strong>
                  <StatusBadge value={check.status} />
                </div>
                <div>{check.message}</div>
                {check.action && <div className="thera-muted" style={{ marginTop: 4 }}>Next action: {check.action}</div>}
              </div>
            ))}
          </div>
          <div className="thera-filter-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="thera-action"
              disabled
              title={appointment.readiness.ready ? "Encounter workflow is connected in the next Phase 1 task." : "Resolve blocking readiness issues first."}
              style={{ opacity: .55 }}
            >
              Start Encounter
            </button>
            {!appointment.readiness.ready && <span className="thera-muted">Resolve the blocking items above before starting care.</span>}
          </div>
        </section>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
