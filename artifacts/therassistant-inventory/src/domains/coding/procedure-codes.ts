import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";

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


type FeeRow = Row & { id: string };

function scheduleApplies(row: Row, serviceDate: string) {
  const effective = String(row.effective_date ?? "");
  const termination = String(row.termination_date ?? "");
  return (!effective || effective <= serviceDate) && (!termination || termination >= serviceDate);
}

export async function resolveProcedureCharge(
  code: string,
  payerId?: string,
  serviceDate = new Date().toISOString().slice(0, 10),
) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const lines = await tenantSelect<FeeRow>("fee_schedule_lines", {
    cpt_code: `eq.${normalized}`,
    order: "updated_at.desc",
  });
  if (!lines.length) return null;

  const scheduleIds = [...new Set(lines.map((line) => String(line.fee_schedule_id ?? "")).filter(Boolean))];
  if (!scheduleIds.length) return null;
  const schedules = (await tenantSelect<FeeRow>("fee_schedules", {
    id: `in.(${scheduleIds.join(",")})`,
    status: "eq.active",
    order: "effective_date.desc.nullslast,updated_at.desc",
  })).filter((schedule) => scheduleApplies(schedule, serviceDate));
  if (!schedules.length) return null;

  if (payerId) {
    const contracts = await tenantSelect<FeeRow>("payer_contracts", {
      payer_id: `eq.${payerId}`,
      status: "eq.active",
      order: "effective_date.desc.nullslast,updated_at.desc",
    });
    const contractIds = new Set(
      contracts.filter((contract) => scheduleApplies(contract, serviceDate)).map((contract) => String(contract.id)),
    );
    for (const schedule of schedules) {
      if (!contractIds.has(String(schedule.payer_contract_id ?? ""))) continue;
      const line = lines.find((candidate) =>
        String(candidate.fee_schedule_id) === String(schedule.id)
        && !String(candidate.modifier ?? "").trim(),
      ) ?? lines.find((candidate) => String(candidate.fee_schedule_id) === String(schedule.id));
      if (line && Number(line.rate_cents) > 0) {
        return { amountCents: Number(line.rate_cents), source: String(schedule.name ?? "Payer fee schedule") };
      }
    }
  }

  for (const schedule of schedules) {
    if (schedule.payer_contract_id) continue;
    const line = lines.find((candidate) =>
      String(candidate.fee_schedule_id) === String(schedule.id)
      && !String(candidate.modifier ?? "").trim(),
    ) ?? lines.find((candidate) => String(candidate.fee_schedule_id) === String(schedule.id));
    if (line && Number(line.rate_cents) > 0) {
      return { amountCents: Number(line.rate_cents), source: String(schedule.name ?? "Standard charges") };
    }
  }
  return null;
}
