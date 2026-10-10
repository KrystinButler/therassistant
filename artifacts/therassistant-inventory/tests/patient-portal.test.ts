import test from "node:test";
import assert from "node:assert/strict";

import { buildPatientPortalData, buildJournalEntryValues, getPortalArrivalAvailability, getPortalArrivalStep, isPortalAppointmentAvailable, planCheckInUpdate } from "../src/domains/portal/workflow.ts";

test("portal returns only patient-facing data", () => {
  const result = buildPatientPortalData({
    patient: { id: "patient-1", first_name: "Taylor", last_name: "Brooks" },
    appointments: [{ id: "appt-1", client_id: "patient-1", starts_at: "2026-09-20T18:00:00Z", appointment_status: "scheduled" }],
    policies: [{ id: "policy-1", client_id: "patient-1", member_id: "MEM123", status: "active" }],
    documents: [{ id: "doc-1", client_id: "patient-1", document_type: "consent_form", document_status: "approved", file_name: "consent.pdf" }],
    checkins: [],
    journalEntries: [{ id: "journal-1", client_id: "patient-1", entry_text: "Weekly reflection" }],
    balance: { id: "balance-1", client_id: "patient-1", open_balance_cents: 2500 },
    now: new Date("2026-09-13T12:00:00Z"),
  });

  assert.equal(result.patient.id, "patient-1");
  assert.equal(result.upcomingAppointments.length, 1);
  assert.equal(result.journalEntries.length, 1);
  assert.equal(result.openBalanceCents, 2500);
  assert.equal("workItems" in result, false);
  assert.equal("credentialing" in result, false);
  assert.equal("claims" in result, false);
});

test("same-day scheduled appointment remains actionable through the service date", () => {
  const appointment = {
    id: "appt-current",
    starts_at: "2026-09-29T15:00:00Z",
    ends_at: "2026-09-29T16:00:00Z",
    appointment_status: "scheduled",
  };
  assert.equal(isPortalAppointmentAvailable(appointment, new Date("2026-09-29T15:15:00Z")), true);
  assert.equal(isPortalAppointmentAvailable(appointment, new Date("2026-09-30T03:30:00Z")), true);
  assert.equal(isPortalAppointmentAvailable(appointment, new Date("2026-09-30T07:00:00Z")), false);
});

test("late same-day arrival skips on-my-way and allows direct arrival", () => {
  const appointment = {
    id: "appt-current",
    starts_at: "2026-09-29T15:00:00Z",
    ends_at: "2026-09-29T16:00:00Z",
    appointment_status: "scheduled",
  };
  const now = new Date("2026-09-30T03:30:00Z");
  assert.deepEqual(getPortalArrivalAvailability(appointment, now), { onMyWay: false, arrival: true });
  assert.equal(getPortalArrivalStep(appointment, {}, now), "arrived");
});

test("portal trusts the server Colorado service date for real appointment payloads", () => {
  const appointment = {
    id: "appt-real-payload",
    starts_at: "2026-10-09T15:00:00+00:00",
    ends_at: "2026-10-09T16:00:00+00:00",
    service_date: "2026-10-09",
    appointment_status: "scheduled",
  };
  const lateSameDay = new Date("2026-10-10T04:59:00Z");
  assert.equal(isPortalAppointmentAvailable(appointment, lateSameDay), true);
  assert.deepEqual(getPortalArrivalAvailability(appointment, lateSameDay), { onMyWay: false, arrival: true });
  assert.equal(getPortalArrivalStep(appointment, {}, lateSameDay), "arrived");
});

test("completed and cancelled appointments are not patient check-in eligible", () => {
  const base = { id: "appt-current", starts_at: "2026-09-29T18:00:00Z", ends_at: "2026-09-29T19:00:00Z" };
  const now = new Date("2026-09-29T18:15:00Z");
  assert.equal(isPortalAppointmentAvailable({ ...base, appointment_status: "completed" }, now), false);
  assert.equal(isPortalAppointmentAvailable({ ...base, appointment_status: "cancelled" }, now), false);
  assert.equal(isPortalAppointmentAvailable({ ...base, appointment_status: "no_show" }, now), false);
});

test("portal exposes all eligible future appointments without a three-visit cap", () => {
  const appointments = Array.from({ length: 5 }, (_, index) => ({
    id: `appt-${index + 1}`,
    starts_at: `2026-10-0${index + 1}T18:00:00Z`,
    ends_at: `2026-10-0${index + 1}T19:00:00Z`,
    appointment_status: "scheduled",
  }));
  const result = buildPatientPortalData({
    patient: { id: "patient-1" }, appointments, policies: [], documents: [], checkins: [], journalEntries: [],
    now: new Date("2026-09-29T12:00:00Z"),
  });
  assert.equal(result.upcomingAppointments.length, 5);
});

test("patient arrival actions are time-gated before the appointment", () => {
  const appointment = {
    id: "appt-future", starts_at: "2026-10-01T16:00:00Z", ends_at: "2026-10-01T17:00:00Z", appointment_status: "scheduled",
  };
  assert.deepEqual(getPortalArrivalAvailability(appointment, new Date("2026-09-29T18:00:00Z")), { onMyWay: false, arrival: false });
  assert.deepEqual(getPortalArrivalAvailability(appointment, new Date("2026-10-01T13:00:00Z")), { onMyWay: true, arrival: false });
  assert.deepEqual(getPortalArrivalAvailability(appointment, new Date("2026-10-01T15:15:00Z")), { onMyWay: true, arrival: true });
});

test("late-cancelled appointments are not patient check-in eligible", () => {
  const appointment = {
    id: "appt-late-cancel", starts_at: "2026-10-01T16:00:00Z", ends_at: "2026-10-01T17:00:00Z", appointment_status: "late_cancel",
  };
  assert.equal(isPortalAppointmentAvailable(appointment, new Date("2026-09-29T18:00:00Z")), false);
});

test("check-in step updates one timestamp", () => {
  assert.deepEqual(Object.keys(planCheckInUpdate("on_my_way", new Date("2026-09-13T12:00:00Z"))), ["on_my_way_at"]);
  assert.deepEqual(Object.keys(planCheckInUpdate("arrived", new Date("2026-09-13T12:05:00Z"))), ["arrived_at"]);
  assert.deepEqual(Object.keys(planCheckInUpdate("checked_in", new Date("2026-09-13T12:10:00Z"))), ["checked_in_at"]);
});

test("journal entries remain separate from clinical notes", () => {
  const values = buildJournalEntryValues({ entryText: "Weekly reflection", mood: "improving" });
  assert.equal(values.entry_text, "Weekly reflection");
  assert.equal(values.author_type, "patient");
  assert.equal("note_text" in values, false);
});

test("default other documents are not patient-facing without explicit classification", () => {
  const result = buildPatientPortalData({
    patient: { id: "patient-1" }, appointments: [], policies: [],
    documents: [
      { id: "doc-consent", client_id: "patient-1", document_type: "consent_form", document_status: "approved" },
      { id: "doc-other", client_id: "patient-1", document_type: "other", document_status: "approved" },
    ],
    checkins: [], journalEntries: [], now: new Date("2026-09-17T12:00:00Z"),
  });
  assert.deepEqual(result.documents.map((row) => row.id), ["doc-consent"]);
});

test("portal separates appointment history from currently available appointments", () => {
  const result = buildPatientPortalData({
    patient: { id: "patient-1" },
    appointments: [
      { id: "future", starts_at: "2026-10-03T18:00:00Z", ends_at: "2026-10-03T19:00:00Z", appointment_status: "scheduled" },
      { id: "past-completed", starts_at: "2026-09-20T18:00:00Z", ends_at: "2026-09-20T19:00:00Z", appointment_status: "completed" },
      { id: "future-cancelled", starts_at: "2026-10-02T18:00:00Z", ends_at: "2026-10-02T19:00:00Z", appointment_status: "cancelled" },
    ],
    policies: [], documents: [], checkins: [], journalEntries: [], now: new Date("2026-09-29T18:00:00Z"),
  });
  assert.deepEqual(result.upcomingAppointments.map((row) => row.id), ["future"]);
  assert.deepEqual(result.appointmentHistory.map((row) => row.id), ["future-cancelled", "past-completed"]);
});
