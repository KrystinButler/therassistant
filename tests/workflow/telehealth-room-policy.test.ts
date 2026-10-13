import assert from "node:assert/strict";
import test from "node:test";

import {
  createDailyMeetingToken,
  createTelehealthRoomName,
  requireDailyHipaaConfiguration,
  shouldReuseTelehealthRoom,
  telehealthRoomExpiresAt,
} from "../../artifacts/api-server/src/lib/daily.ts";

test("telehealth room names are random identifiers without appointment or patient PHI", () => {
  const name = createTelehealthRoomName(() => "8d82fb20-13a8-4d55-a930-e51e335f2e7c");
  assert.equal(name, "thera-8d82fb20-13a8-4d55-a930-e51e335f2e7c");
  assert.doesNotMatch(name, /jordan|ellis|appointment|2026-10-12/i);
});

test("telehealth room expires thirty minutes after the scheduled appointment end", () => {
  assert.equal(
    telehealthRoomExpiresAt("2026-10-12T19:00:00.000Z").toISOString(),
    "2026-10-12T19:30:00.000Z",
  );
});

test("an existing non-expired Daily room is reused", () => {
  assert.equal(shouldReuseTelehealthRoom({
    provider: "daily",
    roomName: "thera-existing",
    url: "https://example.daily.co/thera-existing",
    expiresAt: "2026-10-12T19:30:00.000Z",
  }, new Date("2026-10-12T18:30:00.000Z")), true);

  assert.equal(shouldReuseTelehealthRoom({
    provider: "daily",
    roomName: "thera-existing",
    url: "https://example.daily.co/thera-existing",
    expiresAt: "2026-10-12T19:30:00.000Z",
  }, new Date("2026-10-12T20:00:00.000Z")), false);
});

test("Daily configuration is rejected unless HIPAA mode, API key, and domain are explicitly configured", () => {
  assert.throws(() => requireDailyHipaaConfiguration({
    DAILY_API_KEY: "secret",
    DAILY_DOMAIN: "therassistant.daily.co",
    DAILY_HIPAA_ENABLED: "false",
  }), /HIPAA/i);

  assert.throws(() => requireDailyHipaaConfiguration({
    DAILY_API_KEY: "",
    DAILY_DOMAIN: "therassistant.daily.co",
    DAILY_HIPAA_ENABLED: "true",
  }), /API key/i);

  assert.deepEqual(requireDailyHipaaConfiguration({
    DAILY_API_KEY: "secret",
    DAILY_DOMAIN: "therassistant.daily.co",
    DAILY_HIPAA_ENABLED: "true",
  }), {
    apiKey: "secret",
    domain: "therassistant.daily.co",
  });
});

test("Daily meeting tokens are room-scoped, short-lived, and contain no patient/provider names", async () => {
  let requestBody: Record<string, any> | null = null;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ token: "daily-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const token = await createDailyMeetingToken({
    roomName: "thera-room-1",
    expiresAt: new Date("2026-10-12T19:30:00.000Z"),
    isOwner: false,
    env: {
      DAILY_API_KEY: "secret",
      DAILY_DOMAIN: "therassistant.daily.co",
      DAILY_HIPAA_ENABLED: "true",
    },
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(token, "daily-token");
  assert.equal(requestBody?.properties.room_name, "thera-room-1");
  assert.equal(requestBody?.properties.exp, 1791833400);
  assert.equal(requestBody?.properties.is_owner, false);
  assert.equal(requestBody?.properties.eject_at_token_exp, true);
  assert.equal(requestBody?.properties.enable_prejoin_ui, true);
  assert.equal(requestBody?.properties.enable_recording_ui, false);
  assert.equal("user_name" in requestBody?.properties, false);
  assert.equal("user_id" in requestBody?.properties, false);
});

test("provider meeting token is owner-scoped without changing the room", async () => {
  let requestBody: Record<string, any> | null = null;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ token: "owner-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await createDailyMeetingToken({
    roomName: "thera-room-1",
    expiresAt: new Date("2026-10-12T19:30:00.000Z"),
    isOwner: true,
    env: {
      DAILY_API_KEY: "secret",
      DAILY_DOMAIN: "therassistant.daily.co",
      DAILY_HIPAA_ENABLED: "true",
    },
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(requestBody?.properties.room_name, "thera-room-1");
  assert.equal(requestBody?.properties.is_owner, true);
});