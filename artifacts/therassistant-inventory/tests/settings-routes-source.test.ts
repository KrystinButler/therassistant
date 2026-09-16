import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const routes = [
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
  "/settings",
];

test("App exposes every canonical Settings route and legacy administration redirect", () => {
  for (const route of routes) assert.match(appSource, new RegExp(`path=\\"${route.replaceAll("/", "\\/")}\\"`));
  assert.match(appSource, /path="\/administration"><Redirect to="\/settings"/);
  assert.match(appSource, /path="\/administration\/imports"/);
  assert.match(appSource, /path="\/administration\/database-inventory"/);
});

test("current patient portal check-in routing is preserved", () => {
  assert.match(appSource, /patient-portal\/:clientId\/check-in\/:appointmentId/);
});
