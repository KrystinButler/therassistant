import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

import { useAuth } from "../../auth/auth-context";
import {
  getMyPortalContext,
  type PatientPortalContext,
} from "./portal-client";
import {
  PORTAL_ACTIVATE,
  PORTAL_LOGIN,
  PORTAL_RECOVER,
} from "./routes";

const PatientPortalContextState = createContext<PatientPortalContext | null>(null);

function PortalRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);

  return <div className="thera-state">Redirecting...</div>;
}

function AccessUnavailable({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section className="thera-card" style={{ width: "min(520px, 100%)" }}>
        <h1>Patient portal access unavailable</h1>
        <p>{message}</p>
        <button
          type="button"
          className="thera-action secondary"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}

export function PatientPortalGate({ children }: { children: ReactNode }) {
  const { session, loading: authLoading, signOut } = useAuth();
  const [context, setContext] = useState<PatientPortalContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!session) {
      setContext(null);
      setLoaded(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setLoaded(false);
    setError(null);

    void getMyPortalContext()
      .then((next) => {
        if (!active) return;
        setContext(next);
        setLoaded(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load patient portal access.");
        setLoaded(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session?.access_token]);

  if (authLoading) {
    return <div className="thera-state">Checking patient portal session...</div>;
  }
  if (!session) return <PortalRedirect to={PORTAL_LOGIN} />;
  if (session.flowType === "recovery") return <PortalRedirect to={PORTAL_RECOVER} />;
  if (loading || !loaded) {
    return <div className="thera-state">Loading patient portal...</div>;
  }
  if (error) {
    return <AccessUnavailable message={error} onSignOut={signOut} />;
  }
  if (!context) {
    return (
      <AccessUnavailable
        message="This account is not linked to an active patient portal invitation."
        onSignOut={signOut}
      />
    );
  }
  if (context.status === "invited") return <PortalRedirect to={PORTAL_ACTIVATE} />;
  if (context.status !== "active") {
    return (
      <AccessUnavailable
        message="Patient portal access has been revoked or is otherwise unavailable."
        onSignOut={signOut}
      />
    );
  }

  return (
    <PatientPortalContextState.Provider value={context}>
      {children}
    </PatientPortalContextState.Provider>
  );
}

export function usePatientPortalContext() {
  const value = useContext(PatientPortalContextState);
  if (!value) {
    throw new Error("usePatientPortalContext must be used inside PatientPortalGate.");
  }
  return value;
}
