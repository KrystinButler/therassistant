import test from "node:test";
import assert from "node:assert/strict";

import { buildPatientPortalData, planCheckInUpdate, buildJournalEntryValues } from "../src/domains/portal/workflow.ts";

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
