import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_GROUPS } from "../src/domains/settings/settings-groups";

const expected = [
  ["Practice", ["Practice Information & Locations", "Practice Logo", "Patient Records", "Client Portal"]],
  ["Clinical", ["Service Codes", "Diagnosis Codes", "Interventions"]],
  ["Billing", ["Practice Billing", "Patient Billing", "Payment Processing"]],
  ["Administration", ["Staff", "Activity Log"]],
  ["My Account", ["Change Your Password"]],
] as const;

test("settings groups exactly match the approved information architecture", () => {
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => [group.label, group.items.map((item) => item.label)]),
    expected,
  );
});

test("settings routes are canonical under /settings", () => {
  const hrefs = SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(hrefs, [
    "/settings/practice",
    "/settings/logo",
    "/settings/patient-records",
    "/settings/client-portal",
    "/settings/service-codes",
    "/settings/diagnosis-codes",
    "/settings/interventions",
    "/settings/practice-billing",
    "/settings/patient-billing",
    "/settings/payment-processing",
    "/settings/staff",
    "/settings/activity-log",
    "/settings/password",
  ]);
});
