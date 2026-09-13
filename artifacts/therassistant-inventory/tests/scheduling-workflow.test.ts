import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppointmentInput,
  syntheticEligibilityStatus,
} from "../src/domains/scheduling/workflow.ts";

test("appointment input derives workflow context instead of accepting insurance foreign keys", () => {
  const input = buildAppointmentInput({
    clientId: "client-1",
    providerId: "provider-1",
    date: "2026-09-15",
    time: "10:00",
    durationMinutes: 60,
    locationType: "telehealth",
    serviceType: "Individual Therapy",
    cptCode: "90837",
  });

  assert.equal(input.client_id, "client-1");
  assert.equal(input.provider_id, "provider-1");
  assert.equal(input.appointment_status, "scheduled");
  assert.equal("insurance_policy_id" in input, false);
  assert.equal("payer_id" in input, false);
  assert.equal(
    new Date(input.ends_at).getTime() - new Date(input.starts_at).getTime(),
    60 * 60 * 1000,
  );
});

test("synthetic eligibility adapter returns active for ordinary demo member IDs", () => {
  assert.equal(syntheticEligibilityStatus("DEMO12345"), "active");
});

test("synthetic eligibility adapter demonstrates inactive and unable-to-verify outcomes", () => {
  assert.equal(syntheticEligibilityStatus("DEMO12340"), "inactive");
  assert.equal(syntheticEligibilityStatus("DEMO12349"), "unable_to_verify");
});
