import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createPatientWithOptionalPortal } from "../src/domains/patients/create-patient-with-portal.ts";

test("portal invitation failure does not recreate the patient", async () => {
  let creates = 0;
  let invites = 0;

  const result = await createPatientWithOptionalPortal({
    enrollPortal: true,
    createPatient: async () => {
      creates += 1;
      return { id: "patient-1" };
    },
    invitePortal: async () => {
      invites += 1;
      throw new Error("SMTP unavailable");
    },
  });

  assert.equal(creates, 1);
  assert.equal(invites, 1);
  assert.equal(result.patient.id, "patient-1");
  assert.match(result.portalError ?? "", /SMTP unavailable/);
});

test("save-only never calls invitation service", async () => {
  let invites = 0;

  const result = await createPatientWithOptionalPortal({
    enrollPortal: false,
    createPatient: async () => ({ id: "patient-2" }),
    invitePortal: async () => {
      invites += 1;
      return { status: "invited" };
    },
  });

  assert.equal(invites, 0);
  assert.equal(result.patient.id, "patient-2");
  assert.equal(result.portalInvitation, null);
  assert.equal(result.portalError, null);
});

test("staff enrollment no longer treats patient intake metadata as portal authority", () => {
  const clients = readFileSync(
    fileURLToPath(new URL("../src/pages/clients.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(clients, /p_portal_enrolled:\s*false/);
  assert.match(clients, /createPatientWithOptionalPortal/);
  assert.match(clients, /invitePatientPortal/);
  assert.doesNotMatch(clients, /patient-portal\/\$\{created\.id\}/);
});

test("staff patient chart never opens the patient portal as staff", () => {
  const chart = readFileSync(
    fileURLToPath(new URL("../src/domains/patients/PatientChartPage.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(chart, /PortalAccessPanel/);
  assert.doesNotMatch(chart, /Open Patient Portal/);
  assert.doesNotMatch(chart, /href=.*\/patient-portal\//);
});
