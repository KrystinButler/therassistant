import {
  createContext,
  useCallback,
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

type OrganizationType = "billing_company" | "practice";

type TenantContextValue = {
  tenantId: string | null;
  tenantName: string | null;
  timezone: string | null;
  roles: string[];
  loading: boolean;
  error: string | null;
  needsOrganizationSetup: boolean;
  bootstrapOrganization(name: string, type: OrganizationType): Promise<void>;
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
  const [needsOrganizationSetup, setNeedsOrganizationSetup] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setActiveTenantId(null);
    setTenant(null);
    setRoles([]);
    setNeedsOrganizationSetup(false);

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
        if (!tenantId) {
          if (!active) return;
          setNeedsOrganizationSetup(true);
          return;
        }

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
  }, [user, reloadVersion]);

  const bootstrapOrganization = useCallback(
    async (name: string, type: OrganizationType) => {
      if (!user) throw new Error("An authenticated account is required.");
      const organizationName = name.trim();
      if (!organizationName) throw new Error("Organization name is required.");

      const response = await authenticatedFetch(
        `${SUPABASE_URL}/rest/v1/rpc/bootstrap_tenant_for_user`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_tenant_name: organizationName,
            p_tenant_type: type,
            p_timezone: "America/Denver",
            p_email: user.email ?? null,
            p_display_name: null,
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Unable to create your Therassistant organization (${response.status})${text ? `: ${text}` : ""}`,
        );
      }

      setNeedsOrganizationSetup(false);
      setReloadVersion((version) => version + 1);
    },
    [user],
  );

  const value = useMemo<TenantContextValue>(
    () => ({
      tenantId: tenant?.id ?? null,
      tenantName: tenant?.name ?? null,
      timezone: tenant?.timezone ?? null,
      roles,
      loading,
      error,
      needsOrganizationSetup,
      bootstrapOrganization,
    }),
    [tenant, roles, loading, error, needsOrganizationSetup, bootstrapOrganization],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant must be used inside TenantProvider.");
  return value;
}
