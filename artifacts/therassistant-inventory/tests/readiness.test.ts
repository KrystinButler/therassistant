import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePreSession } from "../src/domains/readiness/evaluate-pre-session.ts";

const readyBase = {
  policy: { status: "active" },
  eligibility: { eligibility_status: "active" },
  authorizationRequired: false,
  authorization: null,
  providerEnrollmentStatus: "approved",
};

test("active coverage with approved provider is ready", () => {
  const result = evaluatePreSession(readyBase);
  assert.equal(result.ready, true);
  assert.equal(result.checks.some((check) => check.blocking), false);
});

test("inactive coverage blocks the appointment", () => {
  const result = evaluatePreSession({
    ...readyBase,
    eligibility: { eligibility_status: "inactive" },
  });

  assert.equal(result.ready, false);
  assert.ok(
    result.checks.some(
      (check) => check.code === "eligibility_inactive" && check.blocking,
    ),
  );
});

test("missing required authorization blocks the appointment", () => {
  const result = evaluatePreSession({
    ...readyBase,
    authorizationRequired: true,
  });

  assert.equal(result.ready, false);
  assert.ok(
    result.checks.some(
      (check) => check.code === "authorization_missing" && check.blocking,
    ),
  );
});

test("approved authorization with remaining units is ready", () => {
  const result = evaluatePreSession({
    ...readyBase,
    authorizationRequired: true,
    authorization: { status: "approved", remaining_units: 4 },
  });

  assert.equal(result.ready, true);
});

test("provider enrollment must be approved", () => {
  const result = evaluatePreSession({
    ...readyBase,
    providerEnrollmentStatus: "submitted",
  });

  assert.equal(result.ready, false);
  assert.ok(
    result.checks.some(
      (check) => check.code === "provider_enrollment" && check.blocking,
    ),
  );
});

test("missing insurance policy blocks the appointment", () => {
  const result = evaluatePreSession({
    ...readyBase,
    policy: null,
  });

  assert.equal(result.ready, false);
  assert.ok(
    result.checks.some(
      (check) => check.code === "insurance_missing" && check.blocking,
    ),
  );
});

test("self-pay patient is ready without payer prerequisites", () => {
  const result = evaluatePreSession({
    billingType: "self_pay",
    policy: null,
    eligibility: null,
    authorizationRequired: false,
    authorization: null,
    providerEnrollmentStatus: null,
  });

  assert.equal(result.ready, true);
  assert.ok(result.checks.some((check) => check.code === "self_pay" && !check.blocking));
  assert.equal(result.checks.some((check) => check.code === "insurance_missing"), false);
});
