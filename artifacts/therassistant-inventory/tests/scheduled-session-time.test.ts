import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {scheduledSessionTime} from "../src/domains/encounters/scheduled-session-time";
test("psychotherapy scheduled duration uses actual timestamp difference and prefills local adjustment time",()=>{
  const appointment={starts_at:"2026-09-24T12:00:00-06:00",ends_at:"2026-09-24T12:53:00-06:00"};
  const result=scheduledSessionTime(appointment);
  assert.equal(result?.minutes,53);
  assert.match(result?.start??"",/^\d{2}:\d{2}$/);
  assert.match(result?.end??"",/^\d{2}:\d{2}$/);
});
test("invalid, missing and reversed appointment times do not invent psychotherapy minutes",()=>{
  assert.equal(scheduledSessionTime(null),null);
  assert.equal(scheduledSessionTime({starts_at:"2026-09-24T12:00:00Z",ends_at:"2026-09-24T11:00:00Z"}),null);
  assert.equal(scheduledSessionTime({starts_at:"bad",ends_at:"bad"}),null);
});
test("encounter shows automatic scheduled minutes; manual start/stop remain hidden unless adjustment requested",()=>{
  const page=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
  assert.match(page,/Calculated automatically from scheduled visit/);
  assert.match(page,/showTimeAdjustment && !signed/);
  assert.match(page,/Reset to scheduled time/);
  assert.match(page,/scheduledSessionTime\(result.appointment\)/);
  assert.match(page,/Confirm that the scheduled time reflects the psychotherapy actually delivered/);
});
