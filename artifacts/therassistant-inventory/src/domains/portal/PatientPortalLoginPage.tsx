import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";

import { useAuth } from "../../auth/auth-context";
import { PORTAL_HOME, PORTAL_RECOVER } from "./routes";

export function PatientPortalLoginPage() {
  const { session, signIn, requestPasswordReset } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session && session.flowType !== "recovery") {
      navigate(PORTAL_HOME, { replace: true });
    }
  }, [navigate, session]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "reset") {
        await requestPasswordReset(
          email.trim(),
          `${window.location.origin}${PORTAL_RECOVER}`,
        );
        setNotice(
          "If a patient portal account exists for that email, a password reset link has been sent.",
        );
        return;
      }

      await signIn(email.trim(), password);
      navigate(PORTAL_HOME, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "reset"
            ? "Unable to request a password reset."
            : "Unable to sign in.",
      );
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
        <div className="thera-card-header">
          <div>
            <h1>{mode === "reset" ? "Reset patient portal password" : "Patient portal sign in"}</h1>
            <p>
              {mode === "reset"
                ? "Enter the email connected to your patient portal invitation."
                : "Use the account created from your practice invitation."}
            </p>
          </div>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Email</span>
          <input
            className="thera-input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {mode === "signin" ? (
          <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            <span className="thera-field-label">Password</span>
            <input
              className="thera-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : null}
        {error ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div> : null}
        {notice ? <div className="thera-state" style={{ marginBottom: 16 }}>{notice}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working
            ? mode === "reset" ? "Sending..." : "Signing in..."
            : mode === "reset" ? "Send reset link" : "Sign in"}
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
