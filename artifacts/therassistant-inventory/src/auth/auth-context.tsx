import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getSession,
  onAuthStateChange,
  requestPasswordRecovery,
  signInWithPassword,
  signOutSession,
  updatePassword,
  type AuthSession,
  type AuthUser,
} from "../lib/supabase-client";
import { setActiveTenantId } from "../lib/tenant-session";

type AuthContextValue = {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  passwordRecovery: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  completePasswordRecovery(password: string): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getSession()
      .then((nextSession) => {
        if (!mounted) return;
        setSession(nextSession);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Unable to load authentication session.");
        setSession(null);
        setLoading(false);
      });

    const unsubscribe = onAuthStateChange((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setError(null);
      setLoading(false);
      if (!nextSession) setActiveTenantId(null);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const nextSession = await signInWithPassword(email, password);
      setSession(nextSession);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to sign in.";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    setActiveTenantId(null);
    try {
      await signOutSession();
      setSession(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to sign out.";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    setError(null);
    try {
      await requestPasswordRecovery(email);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to request a password reset.";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const completePasswordRecovery = useCallback(async (password: string) => {
    setError(null);
    setActiveTenantId(null);
    try {
      await updatePassword(password);
      setSession(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update password.";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      error,
      passwordRecovery: Boolean(session?.recovery),
      signIn,
      signOut,
      requestPasswordReset,
      completePasswordRecovery,
    }),
    [session, loading, error, signIn, signOut, requestPasswordReset, completePasswordRecovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
