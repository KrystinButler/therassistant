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

const retiredRoutes = ["/work-center", "/claims/submission", "/claims/follow-up", "/ar-denials"];

test("active dashboard links use canonical RCM destinations", () => {
  for (const route of retiredRoutes) assert.doesNotMatch(dashboardSource, new RegExp(route.replaceAll("/", "\\/")));
  for (const route of ["/billing/charges", "/rejections", "/claims", "/denials", "/payments"]) {
    assert.match(dashboardSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(dashboardSource, /Claim Submission|Work Center/);
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
