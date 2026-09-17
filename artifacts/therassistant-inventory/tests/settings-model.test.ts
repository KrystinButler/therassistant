import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_SETTINGS_SECTIONS,
  MEMBER_SETTINGS_SECTIONS,
  SETTINGS_LABELS_BY_SECTION,
  getSettingsSectionByRoute,
  settingsRouteBySlug,
} from "../src/domains/settings/model";

const expectedAdminSections = [
  ["general", "General", "/settings/general"],
  ["branding", "Branding", "/settings/branding"],
  ["locations", "Locations", "/settings/locations"],
  ["departments", "Departments", "/settings/departments"],
  ["clinicians", "Clinicians", "/settings/clinicians"],
  ["users", "Users & Roles", "/settings/users"],
  ["appointments", "Appointments", "/settings/appointments"],
  ["scheduling", "Scheduling", "/settings/scheduling"],
  ["clinical", "Clinical", "/settings/clinical"],
  ["documentation", "Documentation", "/settings/documentation"],
  ["compliance", "Compliance", "/settings/compliance"],
  ["payers", "Payers", "/settings/payers"],
  ["billing", "Billing", "/settings/billing"],
  ["notifications", "Notifications", "/settings/notifications"],
  ["patient-portal", "Patient Portal", "/settings/patient-portal"],
  ["integrations", "Integrations", "/settings/integrations"],
  ["security", "Security", "/settings/security"],
  ["data", "Data", "/settings/data"],
  ["my-account", "My Account", "/settings/my-account"],
] as const;

test("admin settings use the approved information architecture in exact order", () => {
  assert.deepEqual(
    ADMIN_SETTINGS_SECTIONS.map(({ slug, label, path }) => [slug, label, path]),
    expectedAdminSections,
  );
  assert.equal(ADMIN_SETTINGS_SECTIONS[0]?.slug, "general");
  assert.equal(ADMIN_SETTINGS_SECTIONS.at(-1)?.slug, "my-account");
});

test("member settings expose only My Account", () => {
  assert.deepEqual(
    MEMBER_SETTINGS_SECTIONS.map(({ slug, label, path }) => [slug, label, path]),
    [["my-account", "My Account", "/member/settings/my-account"]],
  );
});

test("settings routes are indexed by slug and can be resolved by pathname", () => {
  assert.equal(settingsRouteBySlug.scheduling.path, "/settings/scheduling");
  assert.equal(settingsRouteBySlug.billing.label, "Billing");
  assert.equal(getSettingsSectionByRoute("/settings/billing")?.slug, "billing");
  assert.equal(getSettingsSectionByRoute("/settings/billing/advanced")?.slug, "billing");
  assert.equal(getSettingsSectionByRoute("/not-settings"), undefined);
});

test("billing and scheduling labels stay empty until their workspaces are ready", () => {
  assert.deepEqual(SETTINGS_LABELS_BY_SECTION.billing, []);
  assert.deepEqual(SETTINGS_LABELS_BY_SECTION.scheduling, []);
});
