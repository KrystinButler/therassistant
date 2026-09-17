import { useState, type FormEvent } from "react";

import { useAuth } from "./auth-context";

export function PasswordRecoveryPage() {
  const { completePasswordRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <div className="thera-brand-subtitle">Revenue Cycle Operations</div>
          </div>
        </div>
        <div className="thera-card-header">
          <div>
            <h1>Set new password</h1>
            <p>Choose a new password for your authorized Therassistant account.</p>
          </div>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">New password</span>
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Confirm new password</span>
          <input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
          />
        </label>
        {error ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working ? "Updating password..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
