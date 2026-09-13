import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePhone,
  validateDemographics,
  validateContact,
} from "../src/domains/patients/workflow.ts";

test("demographics require first and last name", () => {
  assert.throws(
    () => validateDemographics({ firstName: "", lastName: "Reed" }),
    /First name is required/i,
  );
  assert.throws(
    () => validateDemographics({ firstName: "Morgan", lastName: "" }),
    /Last name is required/i,
  );
});

test("demographics normalize phone and preserve valid status values", () => {
  const result = validateDemographics({
    firstName: "Morgan",
    lastName: "Reed",
    phone: "3035551212",
    clientStatus: "active",
    registrationStatus: "complete",
  });

  assert.equal(result.phone, "303-555-1212");
  assert.equal(result.client_status, "active");
  assert.equal(result.registration_status, "complete");
});

test("contacts require a name and normalize phone", () => {
  assert.throws(() => validateContact({ contactName: "" }), /Contact name is required/i);
  const result = validateContact({ contactName: "Alex Reed", phone: "7205550101", isEmergencyContact: true });
  assert.equal(result.phone, "720-555-0101");
  assert.equal(result.is_emergency_contact, true);
});

test("normalizePhone leaves non-US formatting alone when it cannot normalize ten digits", () => {
  assert.equal(normalizePhone("+1 303 555 1212"), "303-555-1212");
  assert.equal(normalizePhone("ext 42"), "ext 42");
});
