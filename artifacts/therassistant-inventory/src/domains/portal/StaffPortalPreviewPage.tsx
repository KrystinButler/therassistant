import { useState } from "react";
import { Link } from "wouter";
import { useTenant } from "../../auth/tenant-context";
import { useAuth } from "../../auth/auth-context";
import { tenantInsert, tenantSelect, type Row } from "../../lib/tenant-data-client";
import { getClientPortalAccess, invitePatientPortal } from "./staff-portal-access";
import { PORTAL_HOME, PORTAL_JOURNAL, PORTAL_LOGIN } from "./routes";

type TestPatient = Row & { id: string; metadata?: Record<string, unknown> };
type TestProvider = Row & { id: string };
type TestAppointment = Row & { id: string };

/** Staff synthetic preview: never loads actual patient records or calls patient RPCs. */
export function StaffPortalPreviewPage() {
  const { tenantId, roles } = useTenant();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const canProvision = roles.some((role) => ["practice_admin", "billing_company_admin"].includes(role));
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createSyntheticPortalInvite() {
    if (!tenantId || !canProvision || working) return;
    const destination = email.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(destination)) {
      setError("Enter a valid email address you control for a separate test-patient account.");
      return;
    }
    if (destination === String(user?.email ?? "").trim().toLowerCase()) {
      setError("Staff accounts cannot sign in as patients. Use a different email address or separate inbox alias you control.");
      return;
    }
    setWorking(true); setNotice(null); setError(null);
    try {
      const providers = await tenantSelect<TestProvider>("providers", { limit: "1" });
      if (!providers[0]) throw new Error("Set up a provider before enrolling a synthetic test patient.");
      const matches = await tenantSelect<TestPatient>("clients", { email: "eq." + destination, limit: "10" });
      if (matches.some((patient) => patient.metadata?.synthetic !== true || patient.metadata?.portal_test !== true)) {
        throw new Error("This email is already used for a non-test patient. Use a dedicated test email.");
      }
      let patientId = matches[0]?.id;
      if (!patientId) {
        const patient = await tenantInsert<TestPatient>("clients", {
          first_name: "Taylor", last_name: "Synthetic Test Patient",
          email: destination, date_of_birth: "1990-01-01",
          client_status: "active", registration_status: "complete",
          metadata: { synthetic: true, portal_test: true, billing_type: "self_pay" },
        });
        patientId = patient.id;
      }
      const upcoming = await tenantSelect<TestAppointment>("appointments", {
        client_id: "eq." + patientId, starts_at: "gte." + new Date().toISOString(),
        order: "starts_at.asc", limit: "1",
      });
      if (!upcoming.length) {
        const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tenantInsert<TestAppointment>("appointments", {
          client_id: patientId, provider_id: providers[0].id,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
          appointment_status: "scheduled", location_type: "telehealth",
          service_type: "psychotherapy", notes: "Synthetic portal test; not a real patient visit.",
        });
      }
      const access = await getClientPortalAccess(patientId);
      if (!access) {
        await invitePatientPortal(patientId);
        setNotice("Secure invitation sent. Open your separate test inbox, activate the account, then sign in to the actual patient portal.");
      } else {
        setNotice(access.status === "active"
          ? "The synthetic account is active. Sign in with that patient account or use the password-reset option."
          : access.status === "invited"
            ? "An invitation is already pending. Check your separate test inbox."
            : "This synthetic account is revoked. Restore it from the test patient's chart.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to set up the synthetic patient.");
    } finally {
      setWorking(false);
    }
  }

  return <>
    <div className="thera-breadcrumb"><Link href="/clients" className="thera-link">Patients</Link><span>/</span><span>Patient portal testing</span></div>
    <div className="thera-page-header split">
      <div><div className="thera-eyebrow">STAFF DESIGN PREVIEW · SYNTHETIC DATA</div><h1>Patient Portal</h1>
        <p>Preview the patient-facing layout below. The sample controls are not live; use a separately provisioned synthetic patient identity in the actual portal to test journal entries and check-in.</p></div>
      <a href={PORTAL_LOGIN} className="thera-action secondary" target="_blank" rel="noopener noreferrer">Open real patient sign-in ↗</a>
    </div>
    <section className="thera-card" aria-label="Actual patient portal test access" style={{ marginBottom: 17 }}>
      <div className="thera-card-header"><div><h2>Test the real patient portal</h2>
        <p>Use a private browser window to keep your staff account signed in. Admins can enroll a separate synthetic patient by invitation and add a future test appointment; actual patient data is never impersonated.</p></div></div>
      {canProvision ? <div className="thera-filter-row">
        <label htmlFor="synthetic-portal-email">Test-patient email</label>
        <input id="synthetic-portal-email" className="thera-input" type="email" autoComplete="off"
          value={email} onChange={(event) => setEmail(event.target.value)}
          placeholder="An inbox or alias you control, separate from staff login" />
        <button type="button" className="thera-action" disabled={working || !tenantId || !email.trim()}
          onClick={() => void createSyntheticPortalInvite()}>
          {working ? "Sending invitation…" : "Create / Invite Synthetic Test Patient"}
        </button>
      </div> : <p className="thera-muted">Ask an administrator to invite a synthetic test patient. Staff login is never a patient login.</p>}
      {error && <div className="thera-state error" role="alert">{error}</div>}
      {notice && <div className="thera-alert" role="status" style={{ marginTop: 14 }}>{notice}
        <a href={PORTAL_LOGIN} className="thera-action secondary" target="_blank" rel="noopener noreferrer">Open actual patient sign-in ↗</a>
      </div>}
    </section>
    <section className="thera-alert" role="note" style={{ marginBottom: 17 }}>
      <strong>Testing actual patient workflows</strong>
      <p>Activate the secure invitation in your separate test email, then sign in as that synthetic patient in a private browser window. The actual portal supports journal and pre-visit check-in; this preview does not save data.</p>
    </section>
    <div className="thera-metric-grid" style={{ marginBottom: 17 }}>
      <Metric label="Upcoming appointments" value="1" /><Metric label="Active coverage" value="Sample" />
      <Metric label="Portal documents" value="Sample" /><Metric label="Balance" value="$0.00" />
    </div>
    <div className="thera-detail-grid" aria-label="Synthetic patient portal example">
      <section className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>Upcoming Appointments & Check-In</h2><p>Sample only; sign in as the synthetic patient for a real, editable pre-visit check-in.</p></div></div>
        <div className="thera-work-card"><strong>Sample patient · Example visit</strong><p>Psychotherapy · Telehealth · Demonstration only</p>
        <div className="thera-filter-row"><a className="thera-action secondary" href={PORTAL_HOME} target="_blank" rel="noopener noreferrer">Open actual appointments & check-in ↗</a><span className="thera-muted">The preview is not an editable patient session.</span></div></div>
      </section>
      <section className="thera-card"><h2>Demographics</h2><p>Synthetic sample · No real patient records loaded.</p></section>
      <section className="thera-card"><h2>Insurance</h2><p>Sample coverage information, not real insurance.</p></section>
      <section className="thera-card thera-span-2"><h2>Forms & Documents</h2><p>Patient-facing shared documents appear after signing into the real patient portal.</p></section>
      <section className="thera-card thera-span-2"><h2>In-Between Session Journal</h2><p>Only the signed-in patient authors their journal. The preview is not interactive.</p><a className="thera-action secondary" href={PORTAL_JOURNAL} target="_blank" rel="noopener noreferrer">Open actual patient journal ↗</a></section>
    </div>
  </>;
}
function Metric({label,value}:{label:string;value:string}) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}
