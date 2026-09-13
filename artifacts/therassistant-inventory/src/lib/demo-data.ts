type Row = Record<string, any>;

const SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
const SUPABASE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";
const DEMO_TENANT_NAME = "Therassistant Demo";

let tenantIdPromise: Promise<string> | null = null;

async function request<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getDemoTenantId() {
  if (!tenantIdPromise) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/tenants`);
    url.searchParams.set("select", "id");
    url.searchParams.set("name", `eq.${DEMO_TENANT_NAME}`);
    url.searchParams.set("limit", "1");
    tenantIdPromise = request<Row[]>(url).then((rows) => {
      if (!rows[0]?.id) throw new Error("Therassistant Demo tenant not found.");
      return rows[0].id as string;
    });
  }
  return tenantIdPromise;
}

export async function demoInsert<T extends Row>(table: string, values: T) {
  const tenantId = await getDemoTenantId();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  return request<Row[]>(url, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, ...values }),
  }).then((rows) => rows[0]);
}

export async function demoUpdate<T extends Row>(
  table: string,
  id: string,
  values: T,
) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("id", `eq.${id}`);
  return request<Row[]>(url, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export async function demoRows(table: string) {
  const tenantId = await getDemoTenantId();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("tenant_id", `eq.${tenantId}`);
  return request<Row[]>(url);
}

export async function referenceRows(table: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  return request<Row[]>(url);
}
