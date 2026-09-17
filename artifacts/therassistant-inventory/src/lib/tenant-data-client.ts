import { authenticatedFetch, SUPABASE_URL } from "./supabase-client";
import { requireActiveTenantId } from "./tenant-session";

export type Row = Record<string, unknown>;
export type FetchLike = typeof fetch;

export function buildFilterQuery(filters: Record<string, string> = {}) {
  return new URLSearchParams(filters).toString();
}

function withFilters(url: URL, filters: Record<string, string>) {
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return url;
}

async function request<T>(table: string, url: URL, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${table} request failed (${response.status})${text ? `: ${text}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getCurrentTenantId() {
  return requireActiveTenantId();
}

export async function referenceSelect<T extends Row>(
  table: string,
  filters: Record<string, string> = {},
) {
  const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
    select: "*",
    ...filters,
  });
  return request<T[]>(table, url);
}

export async function tenantSelect<T extends Row>(
  table: string,
  filters: Record<string, string> = {},
) {
  const tenantId = requireActiveTenantId();
  return referenceSelect<T>(table, { tenant_id: `eq.${tenantId}`, ...filters });
}

export async function tenantInsert<T extends Row>(table: string, values: Row) {
  const tenantId = requireActiveTenantId();
  const rows = await request<T[]>(table, new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, ...values }),
  });
  if (!rows[0]) throw new Error(`Supabase ${table} insert returned no row.`);
  return rows[0];
}

export async function tenantUpdate<T extends Row>(table: string, id: string, values: Row) {
  const tenantId = requireActiveTenantId();
  const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
    id: `eq.${id}`,
    tenant_id: `eq.${tenantId}`,
  });
  const rows = await request<T[]>(table, url, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error(`Supabase ${table} update returned no row.`);
  return rows[0];
}

export async function tenantUpdateExact<T extends Row>(table: string, id: string, values: Row) {
  const tenantId = requireActiveTenantId();
  const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
    id: `eq.${id}`,
    tenant_id: `eq.${tenantId}`,
  });
  const rows = await request<T[]>(table, url, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });
  if (!rows[0]) throw new Error(`Supabase ${table} update returned no row.`);
  return rows[0];
}

export async function tenantRpc<T>(functionName: string, args: Row = {}) {
  return request<T>(`rpc/${functionName}`, new URL(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`), {
    method: "POST",
    body: JSON.stringify(args),
  });
}
