import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type Icd10SearchResult = {
  code: string;
  name: string;
};

type SupabaseIcd10Row = {
  code?: unknown;
  name?: unknown;
};

const NLM_FALLBACK_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";

async function searchSupabase(value: string, signal?: AbortSignal): Promise<Icd10SearchResult[]> {
  const response = await authenticatedFetch(
    new URL(`${SUPABASE_URL}/rest/v1/rpc/search_icd10_codes`),
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_search: value,
        p_service_date: new Date().toISOString().slice(0, 10),
        p_limit: 15,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ICD-10-CM search failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const rows = await response.json() as SupabaseIcd10Row[];
  return rows
    .map((row) => ({
      code: String(row.code ?? "").trim().toUpperCase(),
      name: String(row.name ?? "").trim(),
    }))
    .filter((row) => Boolean(row.code));
}

async function searchNlm(value: string, signal?: AbortSignal): Promise<Icd10SearchResult[]> {
  const url = new URL(NLM_FALLBACK_URL);
  url.searchParams.set("terms", value);
  url.searchParams.set("count", "15");
  url.searchParams.set("df", "code,name");
  url.searchParams.set("sf", "code,name");
  url.searchParams.set("cf", "code");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error("ICD-10-CM reference search is temporarily unavailable.");

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[3])) return [];

  return (payload[3] as unknown[])
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const code = String(row[0] ?? "").trim().toUpperCase();
      const name = String(row[1] ?? "").trim();
      return code ? { code, name } : null;
    })
    .filter((row): row is Icd10SearchResult => Boolean(row));
}

export async function searchIcd10(
  terms: string,
  signal?: AbortSignal,
): Promise<Icd10SearchResult[]> {
  const value = terms.trim();
  if (value.length < 2) return [];

  try {
    const local = await searchSupabase(value, signal);
    if (local.length) return local;
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
  }

  return searchNlm(value, signal);
}
