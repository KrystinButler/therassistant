export const PORTAL_SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
export const PORTAL_PUBLISHABLE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";

export type PortalRow = Record<string, unknown>;

async function request<T>(table: string, url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: PORTAL_PUBLISHABLE_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Patient portal ${table} request failed (${response.status})${text ? `: ${text}` : ""}`);
  }
  return (await response.json()) as T;
}

function urlFor(table: string, filters: Record<string, string>) {
  const url = new URL(`${PORTAL_SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return url;
}

export async function portalTenantId(patientId: string) {
  const rows = await request<Array<{ tenant_id: string }>>(
    "clients",
    urlFor("clients", { id: `eq.${patientId}`, select: "tenant_id", limit: "1" }),
  );
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw new Error("Patient portal access is unavailable.");
  return tenantId;
}

export async function portalSelect<T extends PortalRow>(
  table: string,
  patientId: string,
  filters: Record<string, string> = {},
) {
  const tenantId = await portalTenantId(patientId);
  return request<T[]>(table, urlFor(table, { tenant_id: `eq.${tenantId}`, ...filters }));
}

export async function portalInsert<T extends PortalRow>(
  table: string,
  patientId: string,
  values: PortalRow,
) {
  const tenantId = await portalTenantId(patientId);
  const response = await fetch(`${PORTAL_SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: PORTAL_PUBLISHABLE_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ tenant_id: tenantId, ...values }),
  });
  if (!response.ok) throw new Error(`Patient portal ${table} insert failed (${response.status}).`);
  const rows = (await response.json()) as T[];
  if (!rows[0]) throw new Error(`Patient portal ${table} insert returned no row.`);
  return rows[0];
}

export async function portalUpdate<T extends PortalRow>(
  table: string,
  patientId: string,
  id: string,
  values: PortalRow,
) {
  const tenantId = await portalTenantId(patientId);
  const url = urlFor(table, { id: `eq.${id}`, tenant_id: `eq.${tenantId}` });
  url.searchParams.delete("select");
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: PORTAL_PUBLISHABLE_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Patient portal ${table} update failed (${response.status}).`);
  const rows = (await response.json()) as T[];
  if (!rows[0]) throw new Error(`Patient portal ${table} update returned no row.`);
  return rows[0];
}
