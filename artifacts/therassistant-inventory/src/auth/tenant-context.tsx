import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { authenticatedFetch, SUPABASE_URL } from "../lib/supabase-client";
import { setActiveTenantId } from "../lib/tenant-session";
import { useAuth } from "./auth-context";

type TenantRow = {
  id: string;
  name: string;
  timezone: string;
  status: string;
};

type TenantContextValue = {
  tenantId: string | null;
  tenantName: string | null;
  timezone: string | null;
  roles: string[];
  loading: boolean;
  error: string | null;
};

const TenantContext = createContext<TenantContextValue | null>(null);

async function selectRows<T>(table: string, filters: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await authenticatedFetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to load ${table} (${response.status})${text ? `: ${text}` : ""}`);
  }
  return (await response.json()) as T[];
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setActiveTenantId(null);
    setTenant(null);
    setRoles([]);

    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const memberships = await selectRows<{ tenant_id: string; status: string; created_at: string }>(
          "tenant_users",
          {
            user_id: `eq.${user.id}`,
            status: "eq.active",
            order: "created_at.asc",
            limit: "1",
          },
        );
        const tenantId = memberships[0]?.tenant_id;
        if (!tenantId) throw new Error("Your account is not assigned to an active Therassistant organization.");

        const [tenantRows, roleRows] = await Promise.all([
          selectRows<TenantRow>("tenants", { id: `eq.${tenantId}`, limit: "1" }),
          selectRows<{ role: string }>("tenant_user_roles", {
            user_id: `eq.${user.id}`,
            tenant_id: `eq.${tenantId}`,
            order: "created_at.asc",
          }),
        ]);

        const nextTenant = tenantRows[0];
        if (!nextTenant) throw new Error("Your Therassistant organization could not be loaded.");
        if (!active) return;
        setTenant(nextTenant);
        setRoles(roleRows.map((row) => row.role));
        setActiveTenantId(nextTenant.id);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to resolve organization access.");
        setActiveTenantId(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      setActiveTenantId(null);
    };
  }, [user]);

  const value = useMemo<TenantContextValue>(
    () => ({
      tenantId: tenant?.id ?? null,
      tenantName: tenant?.name ?? null,
      timezone: tenant?.timezone ?? null,
      roles,
      loading,
      error,
    }),
    [tenant, roles, loading, error],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant must be used inside TenantProvider.");
  return value;
}
