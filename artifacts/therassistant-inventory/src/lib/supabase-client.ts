import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Authentication is required.");

  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
