import { randomUUID } from "node:crypto";

type DailyEnvironment = Record<string, string | undefined>;

export type DailyHipaaConfiguration = {
  apiKey: string;
  domain: string;
};

export type ExistingTelehealthRoom = {
  provider?: string | null;
  roomName?: string | null;
  url?: string | null;
  expiresAt?: string | Date | null;
};

export type DailyRoom = {
  id?: string;
  name: string;
  url: string;
  privacy?: string;
  created_at?: string;
  config?: Record<string, unknown>;
};

export function createTelehealthRoomName(uuidFactory: () => string = randomUUID) {
  return `thera-${uuidFactory()}`;
}

export function telehealthRoomExpiresAt(appointmentEndsAt: string | Date) {
  const end = appointmentEndsAt instanceof Date
    ? appointmentEndsAt
    : new Date(appointmentEndsAt);
  if (!Number.isFinite(end.getTime())) {
    throw new Error("A valid appointment end time is required to create a telehealth room.");
  }
  return new Date(end.getTime() + 30 * 60 * 1000);
}

export function shouldReuseTelehealthRoom(
  room: ExistingTelehealthRoom | null | undefined,
  now = new Date(),
) {
  if (!room) return false;
  if (String(room.provider ?? "").toLowerCase() !== "daily") return false;
  if (!String(room.roomName ?? "").trim() || !String(room.url ?? "").trim()) return false;
  const expiresAt = room.expiresAt instanceof Date
    ? room.expiresAt
    : new Date(String(room.expiresAt ?? ""));
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

export function requireDailyHipaaConfiguration(
  env: DailyEnvironment = process.env,
): DailyHipaaConfiguration {
  if (env.DAILY_HIPAA_ENABLED !== "true") {
    throw new Error("Daily HIPAA mode is not enabled for this THERASSISTANT environment.");
  }

  const apiKey = String(env.DAILY_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("Daily API key is not configured.");
  }

  const domain = String(env.DAILY_DOMAIN ?? "").trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  if (!domain) {
    throw new Error("Daily domain is not configured.");
  }

  return { apiKey, domain };
}

export async function createDailyRoom(input: {
  appointmentEndsAt: string | Date;
  roomName?: string;
  env?: DailyEnvironment;
  fetchImpl?: typeof fetch;
}): Promise<{ room: DailyRoom; expiresAt: Date }> {
  const config = requireDailyHipaaConfiguration(input.env);
  const expiresAt = telehealthRoomExpiresAt(input.appointmentEndsAt);
  const roomName = input.roomName ?? createTelehealthRoomName();
  const fetchImpl = input.fetchImpl ?? fetch;

  const response = await fetchImpl("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomName,
      privacy: "private",
      properties: {
        exp: Math.floor(expiresAt.getTime() / 1000),
        max_participants: 2,
        enable_prejoin_ui: true,
        enable_chat: false,
        enable_screenshare: true,
        eject_at_room_exp: true,
      },
    }),
  });

  const payload = await response.json().catch(() => null) as DailyRoom | { error?: string; info?: string } | null;
  if (!response.ok) {
    const reason = payload && typeof payload === "object"
      ? String((payload as { info?: string; error?: string }).info ?? (payload as { error?: string }).error ?? "")
      : "";
    throw new Error(`Unable to create Daily telehealth room${reason ? `: ${reason}` : "."}`);
  }
  if (!payload || typeof payload !== "object" || !("url" in payload) || !("name" in payload)) {
    throw new Error("Daily returned an invalid room response.");
  }

  return { room: payload as DailyRoom, expiresAt };
}
