import { Link } from "wouter";
import { PORTAL_LOGIN } from "./routes";

/** Staff-only synthetic view: deliberately never calls patient RPCs or assumes a patient identity. */
export function StaffPortalPreviewPage() {
  return <>
    <div className="thera-breadcrumb"><Link href="/clients" className="thera-link">Patients</Link><span>/</span><span>Patient portal preview</span></div>
    <div className="thera-page-header split">
      <div><div className="thera-eyebrow">STAFF DESIGN PREVIEW · SYNTHETIC DATA</div><h1>Patient Portal</h1>
      <p>Preview the patient-facing layout without logging out or impersonating a patient. This view cannot read patient portal data or submit check-ins or journals.</p></div>
      <a href={PORTAL_LOGIN} className="thera-action secondary" target="_blank" rel="noopener noreferrer">Open real patient sign-in ↗</a>
    </div>
    <section className="thera-alert" role="note" style={{ marginBottom: 17 }}>
      <strong>Testing actual patient workflows</strong>
      <p>Open the real portal in a private browser window and sign in as a separately invited synthetic patient. A staff account intentionally cannot access private patient content.</p>
    </section>
    <div className="thera-metric-grid" style={{ marginBottom: 17 }}>
      <Metric label="Upcoming appointments" value="1" />
      <Metric label="Active coverage" value="1" />
      <Metric label="Portal documents" value="2" />
      <Metric label="Balance" value="$0.00" />
    </div>
    <div className="thera-detail-grid" aria-label="Synthetic patient portal example">
      <section className="thera-card thera-span-2">
        <div className="thera-card-header"><div><h2>Upcoming Appointments & Check-In</h2><p>Patient check-in begins before the visit and records arrival status.</p></div></div>
        <div className="thera-work-card"><strong>Sample patient · Example visit</strong><p>Psychotherapy · Telehealth · Demonstration only</p><div className="thera-filter-row"><span className="thera-action secondary">Pre-Visit Check-In</span><span className="thera-action secondary">On My Way</span><span className="thera-action secondary">I Arrived</span></div></div>
      </section>
      <section className="thera-card"><h2>Demographics</h2><p>Synthetic sample · No real patient records loaded.</p></section>
      <section className="thera-card"><h2>Insurance</h2><p>Coverage confirmation and plan details appear here for the invited patient.</p></section>
      <section className="thera-card thera-span-2"><h2>Forms & Documents</h2><p>Patient-facing forms and shared documents will be available here.</p></section>
      <section className="thera-card thera-span-2"><h2>In-Between Session Journal</h2><p>Only the authenticated patient can author journal entries. Staff may review entries the patient chooses to share.</p><span className="thera-action secondary">Open Journal (preview only)</span></section>
    </div>
  </>;
}
function Metric({label,value}:{label:string;value:string}) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}
