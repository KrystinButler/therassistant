import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type ProcedureCodeSearchResult = {
  code: string;
  name: string;
  system: "CPT" | "HCPCS" | string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string;
  descriptionSource: string;
};

type ProcedureRow = {
  code?: unknown;
  name?: unknown;
  system?: unknown;
  version?: unknown;
  effective_from?: unknown;
  effective_to?: unknown;
  description_source?: unknown;
};

function referenceSourceLabel(value: string) {
  if (value === "therassistant_internal") return "THERASSISTANT internal label";
  return value || "Reference source not specified";
}

export function procedureCodeReferenceSummary(
  result: ProcedureCodeSearchResult,
  serviceDate?: string,
) {
  const range =
    result.effectiveFrom && result.effectiveTo
      ? `effective ${result.effectiveFrom} through ${result.effectiveTo}`
      : result.effectiveFrom
        ? `effective ${result.effectiveFrom} onward`
        : result.effectiveTo
          ? `effective through ${result.effectiveTo}`
          : "no effective-date boundary recorded";

  return [
    result.system || "Procedure reference",
    result.version || null,
    range,
    serviceDate ? `matched for DOS ${serviceDate}` : null,
    `source: ${referenceSourceLabel(result.descriptionSource)}`,
  ].filter(Boolean).join(" · ");
}

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
      version: String(row.version ?? "").trim(),
      effectiveFrom: String(row.effective_from ?? "").trim(),
      effectiveTo: String(row.effective_to ?? "").trim(),
      descriptionSource: String(row.description_source ?? "").trim(),
    }))
    .filter((row) => Boolean(row.code));
}
