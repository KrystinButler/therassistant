import { Link } from "wouter";
import { PORTAL_LOGIN } from "../domains/portal/routes";

export function AccountAccessChoice() {
  return (
    <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section className="thera-card" style={{ width: "min(520px, 100%)" }}>
        <div className="thera-brand" style={{ marginBottom: 24 }}>
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT</div>
            <div className="thera-brand-subtitle">Account Access</div>
          </div>
        </div>
        <h1>Account access not configured</h1>
        <p>This account has no active staff organization. If you followed a patient invitation, do not create an organization.</p>
        <p>Use the patient portal with the email that received the invitation. If your invitation is unavailable, ask your practice to confirm the patient's email and send a new invitation.</p>
        <div className="thera-filter-row" style={{ marginTop: 20 }}>
          <Link className="thera-action" href={PORTAL_LOGIN}>Patient portal sign in</Link>
          <Link className="thera-action secondary" href="/organization-setup">I'm setting up a practice or billing company</Link>
        </div>
      </section>
    </main>
  );
}
