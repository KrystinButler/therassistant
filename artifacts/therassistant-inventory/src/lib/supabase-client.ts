const DEFAULT_SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";

export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
).replace(/\/$/, "");
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export type AuthFlowType = "invite" | "recovery" | null;

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  flowType?: AuthFlowType;
  user: AuthUser;
};

type AuthListener = (session: AuthSession | null) => void;

const STORAGE_KEY = "therassistant.auth.session.v1";
const listeners = new Set<AuthListener>();
let refreshPromise: Promise<AuthSession | null> | null = null;
let validatedAccessToken: string | null = null;

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredSession(): AuthSession | null {
  if (!storageAvailable()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession & { recovery?: boolean };
    if (!parsed.flowType && parsed.recovery === true) parsed.flowType = "recovery";
    return parsed;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function notify(session: AuthSession | null) {
  for (const listener of listeners) listener(session);
}

function persistSession(session: AuthSession | null) {
  if (storageAvailable()) {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  if (!session) validatedAccessToken = null;
  notify(session);
}

async function authRequest(path: string, body: Record<string, unknown>, accessToken?: string) {
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.msg ?? payload.message ?? payload.error_description ?? payload.error ?? `Authentication request failed (${response.status}).`));
  }
  return payload;
}

function normalizeSession(
  payload: Record<string, unknown>,
  flowType: AuthFlowType = null,
): AuthSession {
  const expiresIn = Number(payload.expires_in ?? 3600);
  const expiresAt = Number(payload.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn);
  return {
    access_token: String(payload.access_token ?? ""),
    refresh_token: String(payload.refresh_token ?? ""),
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: String(payload.token_type ?? "bearer"),
    flowType,
    user: payload.user as AuthUser,
  };
}

async function refreshSession(
  refreshToken: string,
  flowType: AuthFlowType = null,
): Promise<AuthSession | null> {
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = authRequest("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: refreshToken,
    })
      .then((payload) => {
        const session = normalizeSession(payload, flowType);
        validatedAccessToken = session.access_token;
        persistSession(session);
        return session;
      })
      .catch(() => {
        persistSession(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function sessionFromUrl(): AuthSession | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  const expiresIn = Number(params.get("expires_in") ?? 3600);
  const rawType = params.get("type");
  const flowType: AuthFlowType =
    rawType === "invite" || rawType === "recovery" ? rawType : null;
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: params.get("token_type") ?? "bearer",
    flowType,
    user: { id: "" },
  } satisfies AuthSession;
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return session;
}

async function validateSessionWithAuth(session: AuthSession): Promise<AuthSession | null> {
  if (validatedAccessToken === session.access_token && session.user?.id) return session;

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  } catch {
    throw new Error("Unable to verify your authentication session. Check your connection and try again.");
  }

  if (response.status === 401 || response.status === 403) {
    persistSession(null);
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to verify your authentication session (${response.status}).`);
  }

  const user = (await response.json()) as AuthUser;
  const next = { ...session, user };
  validatedAccessToken = session.access_token;
  persistSession(next);
  return next;
}

export async function getSession(): Promise<AuthSession | null> {
  const urlSession = sessionFromUrl();
  if (urlSession) return validateSessionWithAuth(urlSession);

  const session = readStoredSession();
  if (!session) return null;
  const expiresAt = Number(session.expires_at ?? 0);
  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    return refreshSession(session.refresh_token, session.flowType ?? null);
  }
  return validateSessionWithAuth(session);
}

export async function signInWithPassword(email: string, password: string) {
  const payload = await authRequest("/auth/v1/token?grant_type=password", { email, password });
  const session = normalizeSession(payload);
  validatedAccessToken = session.access_token;
  persistSession(session);
  return session;
}

export async function requestPasswordRecovery(
  email: string,
  redirectTo?: string,
) {
  const suffix = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
  await authRequest(`/auth/v1/recover${suffix}`, { email });
}

export async function updatePasswordForCurrentSession(
  password: string,
  allowedFlow: "invite" | "recovery",
) {
  const session = await getSession();
  if (!session?.access_token || session.flowType !== allowedFlow) {
    throw new Error("A valid authentication flow is required.");
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.msg ?? payload.message ?? payload.error_description ?? payload.error ?? `Unable to update password (${response.status}).`));
  }

  const user = payload as unknown as AuthUser;
  const nextSession = { ...session, user: user.id ? user : session.user };
  persistSession(nextSession);
  return nextSession;
}

export async function updatePassword(password: string) {
  const session = await updatePasswordForCurrentSession(password, "recovery");

  try {
    await authRequest("/auth/v1/logout", {}, session.access_token);
  } catch {
    // The password update may already revoke the recovery session.
  }
  persistSession(null);
}

export function clearAuthFlowType() {
  const session = readStoredSession();
  if (!session) return;
  persistSession({ ...session, flowType: null });
}

export async function signOutSession() {
  const session = readStoredSession();
  try {
    if (session?.access_token) await authRequest("/auth/v1/logout", {}, session.access_token);
  } finally {
    persistSession(null);
  }
}

export function onAuthStateChange(listener: AuthListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Authentication is required.");
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      validatedAccessToken = null;
      notify(readStoredSession());
    }
  });
}
