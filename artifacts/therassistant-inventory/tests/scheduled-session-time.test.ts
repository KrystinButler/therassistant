import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeStructuredSelections } from "../src/domains/clinical/fast-charting";
import { scheduledSessionTime } from "../src/domains/encounters/scheduled-session-time";

test("scheduled appointment duration is reference data, not verified psychotherapy time", () => {
  const appointment = { starts_at: "2026-09-24T12:00:00-06:00", ends_at: "2026-09-24T12:53:00-06:00" };
  const planned = scheduledSessionTime(appointment);
  assert.equal(planned?.minutes, 53);
  assert.equal(normalizeStructuredSelections({}).psychotherapyMinutes, null);
});

test("invalid appointment dates do not invent even scheduled minutes", () => {
  assert.equal(scheduledSessionTime(null), null);
  assert.equal(scheduledSessionTime({ starts_at: "bad", ends_at: "bad" }), null);
  assert.equal(scheduledSessionTime({ starts_at: "2026-09-24T12:00:00Z", ends_at: "2026-09-24T11:00:00Z" }), null);
});

test("actual time confirmation provenance survives normalization", () => {
  const selections = normalizeStructuredSelections({
    psychotherapyMinutes: 48, psychotherapyTimeSource: "actual_start_stop",
    psychotherapyStartTime: "10:05", psychotherapyStopTime: "10:53",
  });
  assert.equal(selections.psychotherapyMinutes, 48);
  assert.equal(selections.psychotherapyTimeSource, "actual_start_stop");
  assert.equal(selections.psychotherapyStartTime, "10:05");
  assert.equal(selections.psychotherapyStopTime, "10:53");
  assert.equal(normalizeStructuredSelections({ psychotherapyMinutes: 60, psychotherapyTimeSource: "scheduled" }).psychotherapyTimeSource, undefined);
});

test("provider must explicitly confirm scheduled duration or enter actual times; signing stays nonblocking", () => {
  const page = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");
  assert.match(page, /setStructuredSelections\(initialSelections\)/);
  assert.doesNotMatch(page, /psychotherapyMinutes:\s*plannedSession\.minutes/);
  assert.match(page, /Confirm actual time matches schedule/);
  assert.match(page, /psychotherapyTimeSource: "confirmed_schedule"/);
  assert.match(page, /psychotherapyTimeSource: minutes === null \? undefined : "actual_start_stop"/);
  assert.match(page, /Actual face-to-face psychotherapy time:/);
  assert.match(page, /signing remains available/);
});
