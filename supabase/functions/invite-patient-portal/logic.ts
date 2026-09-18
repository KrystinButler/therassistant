export type ExistingAccessStatus = "invited" | "active" | "revoked" | null;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeInviteRequest(value: unknown) {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const clientId = String(row.client_id ?? "").trim();
  if (!UUID.test(clientId)) {
    throw new Error("A valid patient ID is required.");
  }

  return { clientId };
}

export function decideInviteAction(status: ExistingAccessStatus) {
  if (status === "active" || status === "invited") {
    return "return-existing" as const;
  }
  return "invite" as const;
}

export function isExistingUserError(message: string | null | undefined) {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes("already registered") ||
    normalized.includes("already exists") ||
    /user\s+.*exists/.test(normalized)
  );
}
