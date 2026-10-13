import assert from "node:assert/strict";
import test from "node:test";

import { decideTelehealthAccess } from "../../artifacts/api-server/src/lib/telehealth-access.ts";

test("practice admins and the assigned clinician can provision an owner session", () => {
  assert.deepEqual(decideTelehealthAccess({
    isPracticeAdmin: true,
    isPlatformAdmin: false,
    isAssignedClinician: false,
    isPortalPatient: false,
    patientCheckInSubmitted: false,
  }), { allowed: true, participant: "staff", isOwner: true });

  assert.deepEqual(decideTelehealthAccess({
    isPracticeAdmin: false,
    isPlatformAdmin: false,
    isAssignedClinician: true,
    isPortalPatient: false,
    patientCheckInSubmitted: false,
  }), { allowed: true, participant: "staff", isOwner: true });
});

test("portal patient cannot join until pre-visit check-in is submitted", () => {
  assert.deepEqual(decideTelehealthAccess({
    isPracticeAdmin: false,
    isPlatformAdmin: false,
    isAssignedClinician: false,
    isPortalPatient: true,
    patientCheckInSubmitted: false,
  }), { allowed: false, reason: "check_in_required" });
});

test("portal patient receives a non-owner session after submitted check-in", () => {
  assert.deepEqual(decideTelehealthAccess({
    isPracticeAdmin: false,
    isPlatformAdmin: false,
    isAssignedClinician: false,
    isPortalPatient: true,
    patientCheckInSubmitted: true,
  }), { allowed: true, participant: "patient", isOwner: false });
});

test("unrelated authenticated users are denied", () => {
  assert.deepEqual(decideTelehealthAccess({
    isPracticeAdmin: false,
    isPlatformAdmin: false,
    isAssignedClinician: false,
    isPortalPatient: false,
    patientCheckInSubmitted: true,
  }), { allowed: false, reason: "forbidden" });
});