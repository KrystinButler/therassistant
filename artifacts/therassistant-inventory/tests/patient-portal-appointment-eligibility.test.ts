import test from "node:test";
import assert from "node:assert/strict";
import { buildPatientPortalData, isPreVisitEligibleAppointment } from "../src/domains/portal/workflow.ts";

test("pre-visit actions never include a future appointment already marked completed", () => {
  const now = new Date("2026-09-26T17:00:00Z");
  const statuses = ["completed", "in_session", "cancelled", "no_show", "late_cancel", "rescheduled"];
  const appointments = [
    ...statuses.map((status) => ({ id: status, starts_at: "2026-09-27T17:00:00Z", appointment_status: status })),
    { id: "scheduled", starts_at: "2026-09-27T17:00:00Z", appointment_status: "scheduled" },
    { id: "past", starts_at: "2026-09-25T17:00:00Z", appointment_status: "scheduled" },
  ];
  const result = buildPatientPortalData({
    patient: { id: "synthetic-patient" },
    appointments,
    policies: [],
    documents: [],
    checkins: [],
    journalEntries: [],
    now,
  });
  assert.deepEqual(result.upcomingAppointments.map((item) => item.id), ["scheduled"]);
  for (const appointment of appointments.slice(0, statuses.length)) {
    assert.equal(isPreVisitEligibleAppointment(appointment, now), false, appointment.appointment_status);
  }
  assert.equal(isPreVisitEligibleAppointment(appointments[statuses.length], now), true);
});
