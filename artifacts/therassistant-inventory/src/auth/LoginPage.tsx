import { useState, type FormEvent } from "react";

import { useAuth } from "./auth-context";

export function LoginPage() {
  const { signIn, requestPasswordReset, error: authError } = useAuth();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        await requestPasswordReset(email.trim());
        setNotice("If an authorized account exists for that email, a password reset link has been sent.");
        return;
      }
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "reset" ? "Unable to request a password reset." : "Unable to sign in.");
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
            <h1>{mode === "reset" ? "Reset password" : "Sign in"}</h1>
            <p>{mode === "reset" ? "Enter the email for your authorized Therassistant account." : "Use your authorized Therassistant account."}</p>
          </div>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
          />
        </label>
        {mode === "signin" ? (
          <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            <span className="thera-field-label">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
            />
          </label>
        ) : null}
        {(error ?? authError) ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error ?? authError}</div> : null}
        {notice ? <div className="thera-state" style={{ marginBottom: 16 }}>{notice}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working ? (mode === "reset" ? "Sending..." : "Signing in...") : (mode === "reset" ? "Send reset link" : "Sign in")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "reset" : "signin");
            setError(null);
            setNotice(null);
          }}
          style={{ width: "100%", marginTop: 12, border: 0, background: "transparent", textDecoration: "underline", cursor: "pointer" }}
        >
          {mode === "signin" ? "Forgot password?" : "Back to sign in"}
        </button>
      </form>
    </main>
  );
}
