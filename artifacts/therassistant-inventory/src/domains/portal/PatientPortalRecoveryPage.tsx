import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";

import { useAuth } from "../../auth/auth-context";
import { PORTAL_LOGIN } from "./routes";

export function PatientPortalRecoveryPage() {
  const { session, completePasswordRecovery } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || session.flowType !== "recovery") {
    return (
      <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <section className="thera-card" style={{ width: "min(520px, 100%)" }}>
          <h1>Password reset unavailable</h1>
          <p>The reset link is missing, expired, or has already been used.</p>
          <button type="button" className="thera-action secondary" onClick={() => navigate(PORTAL_LOGIN, { replace: true })}>
            Patient portal sign in
          </button>
        </section>
      </main>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("Use at least 12 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setWorking(true);
    try {
      await completePasswordRecovery(password);
      navigate(PORTAL_LOGIN, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form className="thera-card" style={{ width: "min(440px, 100%)" }} onSubmit={submit}>
        <div className="thera-brand" style={{ marginBottom: 24 }}>
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT</div>
            <div className="thera-brand-subtitle">Patient Portal</div>
          </div>
        </div>
        <h1>Set new password</h1>
        <p>Choose a new password for your patient portal account.</p>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">New password</span>
          <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Confirm new password</span>
          <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {error ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working ? "Updating..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
