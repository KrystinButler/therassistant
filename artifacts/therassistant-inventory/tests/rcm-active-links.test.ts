import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardSource = readFileSync(
  new URL("../src/pages/dashboard.tsx", import.meta.url),
  "utf8",
);
const billingHubSource = readFileSync(
  new URL("../src/domains/billing/BillingHubPage.tsx", import.meta.url),
  "utf8",
);

const retiredRoutes = ["/claims/submission", "/claims/follow-up", "/ar-denials"];

test("approved dashboard routes to the canonical clinical and revenue-cycle screens", () => {
  for (const route of retiredRoutes) {
    assert.doesNotMatch(dashboardSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const route of ["/schedule", "/clients", "/clinical", "/billing/charges", "/claims", "/work-center"]) {
    assert.match(dashboardSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const section of ["Today's Schedule", "Recent Clients", "My Tasks", "Alerts &amp; Updates"]) {
    assert.ok(dashboardSource.includes(section), section);
  }
  assert.match(dashboardSource, /todayAppointments/);
  assert.match(dashboardSource, /unsignedNotes/);
  assert.match(dashboardSource, /readyCharges/);
  assert.match(dashboardSource, /attentionClaims/);
});

test("Billing Hub routes every financial metric to a canonical owner", () => {
  for (const route of retiredRoutes) assert.doesNotMatch(billingHubSource, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(billingHubSource, /Insurance A\/R[\s\S]{0,100}href="\/claims"/);
  assert.match(billingHubSource, /Patient A\/R[\s\S]{0,100}href="\/payments"/);
  assert.match(billingHubSource, /Active Denials[\s\S]{0,100}href="\/denials"/);
  assert.match(billingHubSource, /Active Appeals[\s\S]{0,100}href="\/denials"/);
  assert.match(billingHubSource, /Underpayments[\s\S]{0,100}href="\/payments"/);
  assert.match(billingHubSource, /Refunds \/ Recoupments[\s\S]{0,100}href="\/payments"/);
  assert.doesNotMatch(billingHubSource, /837P Submission|A\/R & Denials/);
});
