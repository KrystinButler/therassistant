export type OfficeAllyEnvironment = "test" | "production";

export const OFFICE_ALLY_CREDENTIAL_PROFILE = "authorization_api_key" as const;

export type OfficeAllyResolvedConnection =
  | { environment: "test"; synthetic: true }
  | {
      environment: "production";
      synthetic: false;
      credentialProfile: typeof OFFICE_ALLY_CREDENTIAL_PROFILE;
      apiKey: string;
    };

type SupabaseContext = {
  supabaseAdmin: {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
};

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object" && !Array.isArray(row)
      ? row as Record<string, unknown>
      : null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function resolveOfficeAllyConnection(
  ctx: SupabaseContext,
  tenantId: string,
  environment: OfficeAllyEnvironment,
): Promise<OfficeAllyResolvedConnection> {
  if (environment === "test") {
    return { environment: "test", synthetic: true };
  }

  const { data, error } = await ctx.supabaseAdmin.rpc(
    "resolve_office_ally_connection_secret",
    { p_tenant_id: tenantId },
  );
  if (error) {
    throw new Error("Unable to load the Office Ally connection for this practice.");
  }

  const row = firstRow(data);
  if (!row || row.environment !== "production" || row.status !== "production_connected") {
    throw new Error("Office Ally production is not connected for this practice.");
  }

  if (row.credential_profile !== OFFICE_ALLY_CREDENTIAL_PROFILE) {
    throw new Error("The Office Ally credential profile is not supported.");
  }

  const credentials = row.credentials && typeof row.credentials === "object" && !Array.isArray(row.credentials)
    ? row.credentials as Record<string, unknown>
    : {};
  const apiKey = String(credentials.apiKey ?? "").trim();
  if (!apiKey) {
    throw new Error("The Office Ally API key is missing for this practice.");
  }

  return {
    environment: "production",
    synthetic: false,
    credentialProfile: OFFICE_ALLY_CREDENTIAL_PROFILE,
    apiKey,
  };
}
