import test from "node:test";
import assert from "node:assert/strict";

import { startEncounterWorkflow } from "../src/domains/encounters/workflow.ts";
import { signNoteWorkflow } from "../src/domains/clinical/workflow.ts";

function encounterRepo(options: { ready?: boolean; appointmentStatus?: string } = {}) {
  const encounters: Array<Record<string, any>> = [];
  const appointment = {
    id: "appt-1",
    tenant_id: "tenant-1",
    client_id: "client-1",
    provider_id: "provider-1",
    appointment_status: options.appointmentStatus ?? "checked_in",
    location_type: "telehealth",
    service_type: "Individual Therapy",
  };
  let appointmentStatus = appointment.appointment_status;

  return {
    encounters,
    get appointmentStatus() { return appointmentStatus; },
    async getAppointment(id: string) {
      return id === appointment.id ? { ...appointment, appointment_status: appointmentStatus } : null;
    },
    async getExistingEncounterByAppointment(id: string) {
      return encounters.find((row) => row.appointment_id === id) ?? null;
    },
    async getPreSessionContext() {
      return {
        readiness: { ready: options.ready ?? true, checks: [] },
        policyId: "policy-1",
        payerId: "payer-1",
      };
    },
    async createEncounter(values: Record<string, unknown>) {
      const row = { id: "encounter-1", ...values };
      encounters.push(row);
      return row;
    },
    async updateAppointment(_id: string, values: Record<string, unknown>) {
      appointmentStatus = String(values.appointment_status ?? appointmentStatus);
      return { ...appointment, appointment_status: appointmentStatus };
    },
  };
}

test("starting the same appointment twice returns one encounter", async () => {
  const repo = encounterRepo();
  const first = await startEncounterWorkflow(repo, "appt-1");
  const second = await startEncounterWorkflow(repo, "appt-1");

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(repo.encounters.length, 1);
  if (first.ok && second.ok) assert.equal(first.value.id, second.value.id);
  assert.equal(repo.appointmentStatus, "in_session");
});

test("payer readiness issues do not prevent encounter start", async () => {
  const repo = encounterRepo({ ready: false });
  const result = await startEncounterWorkflow(repo, "appt-1");

  assert.equal(result.ok, true);
  assert.equal(repo.encounters.length, 1);
  assert.equal(repo.appointmentStatus, "in_session");
});

test("cancelled, no-show, and rescheduled appointments cannot start encounters", async () => {
  for (const status of ["cancelled", "no_show", "rescheduled"]) {
    const result = await startEncounterWorkflow(encounterRepo({ appointmentStatus: status }), "appt-1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "appointment_not_startable");
  }
});

test("completed appointments can still be documented when no encounter exists", async () => {
  const repo = encounterRepo({ appointmentStatus: "completed" });
  const result = await startEncounterWorkflow(repo, "appt-1");

  assert.equal(result.ok, true);
  assert.equal(repo.encounters.length, 1);
});

function clinicalRepo(overrides: Record<string, unknown> = {}) {
  const signatures: Array<Record<string, unknown>> = [];
  let readinessRuns = 0;
  let noteStatus = "ready_for_signature";

  return {
    signatures,
    get readinessRuns() { return readinessRuns; },
    get noteStatus() { return noteStatus; },
    async getClinicalState() {
      return {
        encounter: { id: "encounter-1", provider_id: "provider-1" },
        note: { id: "note-1", note_text: "Client made progress toward goal.", note_status: noteStatus },
        diagnoses: [{ id: "dx-1", diagnosis_code: "F41.1" }],
        serviceLines: [{ id: "line-1", cpt_hcpcs_code: "90837" }],
        ...overrides,
      };
    },
    async createSignature(values: Record<string, unknown>) {
      signatures.push(values);
      return { id: "sig-1", ...values };
    },
    async updateNote(_id: string, values: Record<string, unknown>) {
      noteStatus = String(values.note_status ?? noteStatus);
      return { id: "note-1", ...values };
    },
    async runBillingReadiness() {
      readinessRuns += 1;
      return { ready: true, checks: [] };
    },
  };
}

test("signing requires clinical note text", async () => {
  const repo = clinicalRepo({
    note: { id: "note-1", note_text: "", note_status: "ready_for_signature" },
  });
  const result = await signNoteWorkflow(repo, "encounter-1", "provider-1", "Jamie Parker, LCSW");

  assert.equal(result.ok, false);
  assert.equal(repo.signatures.length, 0);
});

test("diagnosis and service-line gaps do not block the clinical signature", async () => {
  const repo = clinicalRepo({ diagnoses: [], serviceLines: [] });
  const result = await signNoteWorkflow(repo, "encounter-1", "provider-1", "Jamie Parker, LCSW");

  assert.equal(result.ok, true);
  assert.equal(repo.signatures.length, 1);
  assert.equal(repo.noteStatus, "signed");
  assert.equal(repo.readinessRuns, 1);
});

test("signing records provider identity, locks note, then runs billing readiness", async () => {
  const repo = clinicalRepo();
  const result = await signNoteWorkflow(repo, "encounter-1", "provider-1", "Jamie Parker, LCSW");

  assert.equal(result.ok, true);
  assert.equal(repo.signatures.length, 1);
  assert.equal(repo.signatures[0].provider_id, "provider-1");
  assert.equal(repo.signatures[0].signer_id, undefined);
  assert.equal(repo.noteStatus, "signed");
  assert.equal(repo.readinessRuns, 1);
});

test("billing-readiness failure does not undo a clinical signature", async () => {
  const repo = clinicalRepo();
  repo.runBillingReadiness = async () => {
    throw new Error("Billing service unavailable");
  };

  const result = await signNoteWorkflow(repo, "encounter-1", "provider-1", "Jamie Parker, LCSW");

  assert.equal(result.ok, true);
  assert.equal(repo.signatures.length, 1);
  assert.equal(repo.noteStatus, "signed");
});
