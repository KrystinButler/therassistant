import { useState } from "react";
import { Link } from "wouter";
import { useTenant } from "../../auth/tenant-context";
import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { PORTAL_HOME, PORTAL_JOURNAL, PORTAL_LOGIN } from "./routes";

type TestCredentials = { email: string; password: string; login_path: string; patient_id: string };

/** Staff synthetic preview: never loads actual patient records or calls patient RPCs. */
export function StaffPortalPreviewPage() {
  const { tenantId, roles } = useTenant();
  const canProvision = roles.some((role) => ["practice_admin", "billing_company_admin"].includes(role));
  const [working, setWorking] = useState(false);
  const [credentials, setCredentials] = useState<TestCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function provisionTestPatient() {
    if (!tenantId || !canProvision || working) return;
    setWorking(true);
    setCredentials(null);
    setError(null);
    try {
      const response = await authenticatedFetch(SUPABASE_URL + "/functions/v1/provision-test-patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const body = await response.json() as Partial<TestCredentials> & { error?: string };
      if (!response.ok || !body.email || !body.password) {
        throw new Error(body.error || "Unable to provision a synthetic test-patient login.");
      }
      setCredentials({
        email: body.email,
        password: body.password,
        login_path: PORTAL_LOGIN,
        patient_id: body.patient_id || "",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create a test-patient login.");
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
        <p>Use a private browser window to keep your staff account signed in. Admins may generate a separate synthetic patient login with one future test appointment; actual patient data is never impersonated.</p></div></div>
      {canProvision ? <button type="button" className="thera-action" disabled={working || !tenantId} onClick={() => void provisionTestPatient()}>
        {working ? "Creating test login…" : "Create / Reset Synthetic Patient Login"}
      </button> : <p className="thera-muted">Ask a practice administrator to create a synthetic test patient. Staff cannot override real patient authentication.</p>}
      {error && <div className="thera-state error" role="alert">{error}</div>}
      {credentials && <div className="thera-alert" role="status" style={{ marginTop: 14 }}>
        <strong>Synthetic patient login (shown only on this screen until you leave)</strong>
        <p>Test email: <code>{credentials.email}</code></p>
        <p>Temporary password: <code>{credentials.password}</code></p>
        <p>Open a private browser window, use the email and password above, then test the real Journal and Pre-Visit Check-In. Generating the login again replaces its previous password.</p>
        <a href={PORTAL_LOGIN} className="thera-action" target="_blank" rel="noopener noreferrer">Open actual patient portal ↗</a>
        <button type="button" className="thera-action secondary" onClick={() => setCredentials(null)}>Hide credentials</button>
      </div>}
    </section>
    <section className="thera-alert" role="note" style={{ marginBottom: 17 }}>
      <strong>Testing actual patient workflows</strong>
      <p>Open the real portal in a private browser window and sign in as your separately provisioned synthetic patient. The staff-only preview cannot save journal or check-in data.</p>
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
