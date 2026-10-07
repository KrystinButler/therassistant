import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./auth-context";
import { clearAuthFlowType, updatePasswordForCurrentSession } from "../lib/supabase-client";
import { getMyPortalContext } from "../domains/portal/portal-client";
import { PatientPortalActivatePage } from "../domains/portal/PatientPortalActivatePage";

/** Auth invites are shared by staff and patients; only the server mapping identifies a patient. */
export function InvitationGate() {
  const { session, signOut } = useAuth();
  const [kind, setKind] = useState<"checking" | "patient" | "staff">("checking");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setKind("checking");
    setError(null);
    void getMyPortalContext().then(context => {
      if (active) setKind(context ? "patient" : "staff");
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to verify invitation.");
    });
    return () => { active = false; };
  }, [session?.user.id, attempt]);
  if (error) return <main className="thera-main"><section className="thera-card">
    <h1>Unable to verify invitation</h1><p role="alert">{error}</p>
    <button className="thera-action" onClick={() => setAttempt(value => value + 1)}>Try again</button>
    <button className="thera-action secondary" onClick={() => void signOut().catch(cause => setError(String(cause)))}>Sign out</button>
  </section></main>;
  if (kind === "checking") return <div className="thera-state">Verifying your invitation...</div>;
  return kind === "patient" ? <PatientPortalActivatePage /> : <StaffInvitationPage />;
}

function StaffInvitationPage() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setError(null);
    if (password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setWorking(true);
    try {
      await updatePasswordForCurrentSession(password, "staff_invite");
      navigate("/", { replace: true });
      clearAuthFlowType();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to activate your account.");
    } finally { setWorking(false); }
  }
  return <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <form className="thera-card" style={{ width: "min(440px, 100%)" }} onSubmit={submit}>
      <div className="thera-brand-name">THERASSISTANT</div>
      <h1>Activate EHR account</h1>
      <p>Create your password to continue to your EHR account.</p>
      <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>Password
        <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} disabled={working} value={password} onChange={event => setPassword(event.target.value)} />
      </label>
      <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>Confirm password
        <input className="thera-input" type="password" autoComplete="new-password" required minLength={12} disabled={working} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
      </label>
      {error && <p className="thera-state error" role="alert">{error}</p>}
      <button className="thera-action" type="submit" disabled={working}>{working ? "Activating..." : "Activate EHR account"}</button>
    </form>
  </main>;
}
