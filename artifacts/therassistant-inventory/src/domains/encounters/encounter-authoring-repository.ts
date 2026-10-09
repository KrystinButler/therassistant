import { tenantSelect, type Row } from "../../lib/tenant-data-client";

type ProviderUserLinkRow = Row & {
  provider_id?: string | null;
  status?: string | null;
};

export async function getActiveProviderLinksForUser(userId: string) {
  if (!userId) return [];

  const rows = await tenantSelect<ProviderUserLinkRow>("provider_user_links", {
    user_id: `eq.${userId}`,
    status: "eq.active",
    select: "provider_id,status",
  });

  return rows
    .map((row) => String(row.provider_id ?? "").trim())
    .filter(Boolean);
}
