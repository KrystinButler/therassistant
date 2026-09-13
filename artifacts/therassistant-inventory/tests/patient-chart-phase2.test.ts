import test from "node:test";
import assert from "node:assert/strict";

import { summarizePatientReadiness } from "../src/domains/patients/chart.ts";

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
