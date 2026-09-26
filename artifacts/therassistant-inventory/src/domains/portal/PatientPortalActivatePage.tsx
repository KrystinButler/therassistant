import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";

import { useAuth } from "../../auth/auth-context";
import {
  clearAuthFlowType,
  updatePasswordForCurrentSession,
} from "../../lib/supabase-client";
import { activateMyPortalAccess, getMyPortalContext } from "./portal-client";
import { PORTAL_HOME, PORTAL_LOGIN, PORTAL_RECOVER } from "./routes";

export function PatientPortalActivatePage() {
  const { session } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invitation, setInvitation] = useState<"checking" | "invited" | "unavailable">("checking");

  useEffect(() => {
    let active = true;
    if (!session || session.flowType === "recovery") {
      setInvitation("unavailable");
      if (session?.flowType === "recovery") navigate(PORTAL_RECOVER, { replace: true });
      return () => { active = false; };
    }
    setInvitation("checking");
    setError(null);
    // A successful email verification may arrive without type=invite when the
    // Supabase Site URL is used. The authoritative identity is the server-side
    // patient invitation mapped to the authenticated user's email, not the URL.
    void getMyPortalContext().then((context) => {
      if (!active) return;
      if (context?.status === "active") {
        navigate(PORTAL_HOME, { replace: true });
        return;
      }
      const matchingEmail = Boolean(session.user?.email)
        && String(context?.invited_email ?? "").trim().toLowerCase()
          === String(session.user.email).trim().toLowerCase();
      setInvitation(context?.status === "invited" && matchingEmail ? "invited" : "unavailable");
    }).catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Could not verify your invitation.");
      setInvitation("unavailable");
    });
    return () => { active = false; };
  }, [session?.access_token, session?.flowType, session?.user?.email, navigate]);

  if (session && invitation === "checking") {
    return <div className="thera-state">Verifying your patient invitation...</div>;
  }
  if (!session || invitation !== "invited") {
    return (
      <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <section className="thera-card" style={{ width: "min(520px, 100%)" }}>
          <h1>Invitation unavailable</h1>
          <p>{error ?? "This session is not linked to a pending patient invitation. If you just accepted your invitation, open the patient sign-in page in the same browser, or request assistance from the practice."}</p>
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
      setError("Use at least 12 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setWorking(true);
    try {
      await updatePasswordForCurrentSession(password, "invite");
      await activateMyPortalAccess();
      clearAuthFlowType();
      navigate(PORTAL_HOME, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to activate patient portal access.");
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
        <h1>Activate patient portal</h1>
        <p>Create the password you will use to sign in.</p>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Password</span>
          <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Confirm password</span>
          <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {error ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working ? "Activating..." : "Activate portal"}
        </button>
      </form>
    </main>
  );
}
