import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPatientChartAggregate,
  summarizePatientReadiness,
} from "../src/domains/patients/chart.ts";

test("patient chart summary resolves payer, next appointment, authorization alert and open work", () => {
  const summary = summarizePatientReadiness({
    patient: {
      id: "patient-1",
      registration_status: "complete",
    },
    insurancePolicies: [
      {
        id: "policy-secondary",
        client_id: "patient-1",
        payer_id: "payer-2",
        insurance_order: "secondary",
        status: "active",
      },
      {
        id: "policy-primary",
        client_id: "patient-1",
        payer_id: "payer-1",
        insurance_order: "primary",
        status: "active",
      },
    ],
    payers: [
      { id: "payer-1", name: "Health First Colorado" },
      { id: "payer-2", name: "Secondary Plan" },
    ],
    appointments: [
      { id: "past", client_id: "patient-1", starts_at: "2026-09-01T10:00:00Z", appointment_status: "completed" },
      { id: "appt-2", client_id: "patient-1", starts_at: "2026-09-25T10:00:00Z", appointment_status: "scheduled" },
      { id: "appt-1", client_id: "patient-1", starts_at: "2026-09-20T10:00:00Z", appointment_status: "scheduled" },
    ],
    authorizations: [
      { id: "auth-1", client_id: "patient-1", payer_id: "payer-1", status: "approved", end_date: "2026-12-31" },
    ],
    authorizationUnits: [
      { id: "units-1", authorization_id: "auth-1", authorized_units: 10, used_units: 8, remaining_units: 2 },
    ],
    workItems: [
      { id: "work-1", source_object_type: "client", source_object_id: "patient-1", workqueue_status: "open" },
      { id: "work-2", source_object_type: "client", source_object_id: "patient-1", workqueue_status: "pending" },
      { id: "work-3", source_object_type: "client", source_object_id: "patient-1", workqueue_status: "completed" },
    ],
    now: new Date("2026-09-13T12:00:00Z"),
  });

  assert.equal(summary.primaryPayerName, "Health First Colorado");
  assert.equal(summary.nextAppointmentId, "appt-1");
  assert.equal(summary.authorizationAlert, "2 units remaining");
  assert.equal(summary.openWorkCount, 2);
  assert.equal(summary.registrationStatus, "complete");
});

test("patient chart aggregate keeps only patient-owned records and enriches payer/provider context", () => {
  const chart = buildPatientChartAggregate({
    patientId: "patient-1",
    patients: [{ id: "patient-1", first_name: "Jordan", last_name: "Ellis", registration_status: "complete" }],
    contacts: [{ id: "contact-1", client_id: "patient-1", contact_name: "Alex Ellis" }],
    policies: [{ id: "policy-1", client_id: "patient-1", payer_id: "payer-1", insurance_order: "primary", status: "active", member_id: "MEM1" }],
    eligibility: [{ id: "elig-1", client_id: "patient-1", payer_id: "payer-1", eligibility_status: "active", service_date: "2026-09-13" }],
    authorizations: [{ id: "auth-1", client_id: "patient-1", payer_id: "payer-1", status: "approved" }],
    authorizationUnits: [{ id: "unit-1", authorization_id: "auth-1", authorized_units: 12, used_units: 10, remaining_units: 2 }],
    appointments: [{ id: "appt-1", client_id: "patient-1", provider_id: "provider-1", starts_at: "2026-09-20T10:00:00Z", appointment_status: "scheduled" }],
    encounters: [{ id: "enc-1", client_id: "patient-1", provider_id: "provider-1", payer_id: "payer-1" }],
    treatmentPlans: [{ id: "plan-1", client_id: "patient-1", provider_id: "provider-1", status: "active" }],
    treatmentGoals: [{ id: "goal-1", treatment_plan_id: "plan-1", goal_text: "Improve coping" }],
    notes: [{ id: "note-1", client_id: "patient-1", provider_id: "provider-1", note_status: "signed" }],
    charges: [{ id: "charge-1", client_id: "patient-1", payer_id: "payer-1" }],
    claims: [{ id: "claim-1", client_id: "patient-1", payer_id: "payer-1" }],
    payments: [{ id: "payment-1", client_id: "patient-1", payer_id: "payer-1" }],
    denials: [{ id: "denial-1", client_id: "patient-1", payer_id: "payer-1" }],
    documents: [{ id: "document-1", client_id: "patient-1", file_name: "consent.pdf" }],
    checkins: [{ id: "checkin-1", client_id: "patient-1", appointment_id: "appt-1" }],
    workItems: [{ id: "work-1", source_object_type: "client", source_object_id: "patient-1", workqueue_status: "open" }],
    providers: [{ id: "provider-1", first_name: "Jamie", last_name: "Parker" }],
    payers: [{ id: "payer-1", name: "Health First Colorado" }],
    plans: [],
    balances: [{ id: "balance-1", client_id: "patient-1", open_balance_cents: 2500, credit_balance_cents: 0 }],
    now: new Date("2026-09-13T12:00:00Z"),
  });

  assert.equal(chart.patient.id, "patient-1");
  assert.equal(chart.contacts.length, 1);
  assert.equal(chart.insurancePolicies[0].payerName, "Health First Colorado");
  assert.equal(chart.appointments[0].providerName, "Jamie Parker");
  assert.equal(chart.treatmentPlans[0].goals.length, 1);
  assert.equal(chart.openBalanceCents, 2500);
  assert.equal(chart.summary.primaryPayerName, "Health First Colorado");
});
