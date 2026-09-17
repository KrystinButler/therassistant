export const SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";

export type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user: AuthUser;
};

type AuthListener = (session: AuthSession | null) => void;

const STORAGE_KEY = "therassistant.auth.session.v1";
const listeners = new Set<AuthListener>();
let refreshPromise: Promise<AuthSession | null> | null = null;

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredSession(): AuthSession | null {
  if (!storageAvailable()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
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

function normalizeSession(payload: Record<string, unknown>): AuthSession {
  const expiresIn = Number(payload.expires_in ?? 3600);
  const expiresAt = Number(payload.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn);
  return {
    access_token: String(payload.access_token ?? ""),
    refresh_token: String(payload.refresh_token ?? ""),
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: String(payload.token_type ?? "bearer"),
    user: payload.user as AuthUser,
  };
}

async function refreshSession(refreshToken: string): Promise<AuthSession | null> {
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = authRequest("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: refreshToken,
    })
      .then((payload) => {
        const session = normalizeSession(payload);
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
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: params.get("token_type") ?? "bearer",
    user: { id: "" },
  } satisfies AuthSession;
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return session;
}

async function hydrateUser(session: AuthSession): Promise<AuthSession> {
  if (session.user?.id) return session;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!response.ok) return session;
  const user = (await response.json()) as AuthUser;
  const next = { ...session, user };
  persistSession(next);
  return next;
}

export async function getSession(): Promise<AuthSession | null> {
  const urlSession = sessionFromUrl();
  if (urlSession) {
    const hydrated = await hydrateUser(urlSession);
    persistSession(hydrated);
    return hydrated;
  }

  const session = readStoredSession();
  if (!session) return null;
  const expiresAt = Number(session.expires_at ?? 0);
  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    return refreshSession(session.refresh_token);
  }
  return hydrateUser(session);
}

export async function signInWithPassword(email: string, password: string) {
  const payload = await authRequest("/auth/v1/token?grant_type=password", { email, password });
  const session = normalizeSession(payload);
  persistSession(session);
  return session;
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
    if (event.key === STORAGE_KEY) notify(readStoredSession());
  });
}
