import { authenticatedFetch } from "../../lib/supabase-client";

export type TelehealthSession = {
  state: "ready";
  provider: "daily";
  participant: "staff" | "patient";
  roomUrl: string;
  meetingToken: string;
  expiresAt: string;
};

export type TelehealthErrorCode =
  | "CHECK_IN_REQUIRED"
  | "NOT_TELEHEALTH"
  | "TELEHEALTH_UNAVAILABLE"
  | "UNKNOWN";

export class TelehealthSessionError extends Error {
  code: TelehealthErrorCode;
  status: number;

  constructor(message: string, code: TelehealthErrorCode, status: number) {
    super(message);
    this.name = "TelehealthSessionError";
    this.code = code;
    this.status = status;
  }
}

export async function ensureTelehealthSession(appointmentId: string): Promise<TelehealthSession> {
  const response = await authenticatedFetch(
    `/api/telehealth/appointments/${encodeURIComponent(appointmentId)}/session`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : "Telehealth is unavailable.";
    const code = typeof payload?.code === "string"
      ? payload.code as TelehealthErrorCode
      : "UNKNOWN";
    throw new TelehealthSessionError(message, code, response.status);
  }
  if (
    payload?.state !== "ready" ||
    payload.provider !== "daily" ||
    typeof payload.roomUrl !== "string" ||
    typeof payload.meetingToken !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    throw new TelehealthSessionError("Telehealth returned an invalid session.", "UNKNOWN", 502);
  }
  return payload as TelehealthSession;
}