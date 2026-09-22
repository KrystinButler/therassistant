import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type ProcedureCodeSearchResult = {
  code: string;
  name: string;
  system: "CPT" | "HCPCS" | string;
  descriptionSource: string;
};

type ProcedureRow = {
  code?: unknown;
  name?: unknown;
  system?: unknown;
  description_source?: unknown;
};

export async function searchProcedureCodes(
  terms: string,
  serviceDate?: string,
  signal?: AbortSignal,
): Promise<ProcedureCodeSearchResult[]> {
  const value = terms.trim();
  if (value.length < 2) return [];

  const response = await authenticatedFetch(
    new URL(`${SUPABASE_URL}/rest/v1/rpc/search_procedure_codes`),
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_search: value,
        p_service_date: serviceDate || new Date().toISOString().slice(0, 10),
        p_limit: 20,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Procedure reference search failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const rows = await response.json() as ProcedureRow[];
  return rows
    .map((row) => ({
      code: String(row.code ?? "").trim().toUpperCase(),
      name: String(row.name ?? "").trim(),
      system: String(row.system ?? "").trim(),
      descriptionSource: String(row.description_source ?? "").trim(),
    }))
    .filter((row) => Boolean(row.code));
}
