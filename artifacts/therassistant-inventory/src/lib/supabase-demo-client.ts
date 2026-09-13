export type Row = Record<string, unknown>;
export type FetchLike = typeof fetch;

const SUPABASE_URL = "https://lpjwfdvaxobewxcklenl.supabase.co";
const SUPABASE_KEY = "sb_publishable_JaHqUqIU43A0EwuE5yPXEw_VZYIASqH";
const DEMO_TENANT_NAME = "Therassistant Demo";

export function buildFilterQuery(filters: Record<string, string> = {}) {
  return new URLSearchParams(filters).toString();
}

function withFilters(url: URL, filters: Record<string, string>) {
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function createDemoClient(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
) {
  let tenantIdPromise: Promise<string> | null = null;

  async function request<T>(table: string, url: URL, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(url, {
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
      throw new Error(
        `Supabase ${table} request failed (${response.status})${text ? `: ${text}` : ""}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function getDemoTenantId() {
    if (!tenantIdPromise) {
      const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/tenants`), {
        select: "id",
        name: `eq.${DEMO_TENANT_NAME}`,
        limit: "1",
      });

      tenantIdPromise = request<Array<{ id: string }>>("tenants", url).then((rows) => {
        if (!rows[0]?.id) throw new Error("Therassistant Demo tenant not found.");
        return rows[0].id;
      });
    }
    return tenantIdPromise;
  }

  async function referenceSelect<T extends Row>(
    table: string,
    filters: Record<string, string> = {},
  ) {
    const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
      select: "*",
      ...filters,
    });
    return request<T[]>(table, url);
  }

  async function demoSelect<T extends Row>(
    table: string,
    filters: Record<string, string> = {},
  ) {
    const tenantId = await getDemoTenantId();
    return referenceSelect<T>(table, {
      tenant_id: `eq.${tenantId}`,
      ...filters,
    });
  }

  async function demoInsert<T extends Row>(table: string, values: Row) {
    const tenantId = await getDemoTenantId();
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    const rows = await request<T[]>(table, url, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ tenant_id: tenantId, ...values }),
    });
    if (!rows[0]) throw new Error(`Supabase ${table} insert returned no row.`);
    return rows[0];
  }

  async function demoUpdate<T extends Row>(table: string, id: string, values: Row) {
    const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
      id: `eq.${id}`,
    });
    const rows = await request<T[]>(table, url, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
    });
    if (!rows[0]) throw new Error(`Supabase ${table} update returned no row.`);
    return rows[0];
  }

  async function demoUpdateExact<T extends Row>(table: string, id: string, values: Row) {
    const url = withFilters(new URL(`${SUPABASE_URL}/rest/v1/${table}`), {
      id: `eq.${id}`,
    });
    const rows = await request<T[]>(table, url, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(values),
    });
    if (!rows[0]) throw new Error(`Supabase ${table} update returned no row.`);
    return rows[0];
  }

  return {
    getDemoTenantId,
    referenceSelect,
    demoSelect,
    demoInsert,
    demoUpdate,
    demoUpdateExact,
  };
}

const demoClient = createDemoClient();

export const getDemoTenantId = demoClient.getDemoTenantId;
export const referenceSelect = demoClient.referenceSelect;
export const demoSelect = demoClient.demoSelect;
export const demoInsert = demoClient.demoInsert;
export const demoUpdate = demoClient.demoUpdate;
export const demoUpdateExact = demoClient.demoUpdateExact;
