import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SETTINGS_SECTION_STATUS,
  SETTINGS_LABELS_BY_SECTION,
  getSettingsSectionStatus,
} from "../src/domains/settings/model";

const settingsPageSource = readFileSync(
  new URL("../src/domains/settings/SettingsPage.tsx", import.meta.url),
  "utf8",
);

test("Settings sections default to a safe Not Configured status", () => {
  assert.equal(DEFAULT_SETTINGS_SECTION_STATUS, "Not Configured");
  assert.equal(getSettingsSectionStatus("general"), "Not Configured");
  assert.equal(getSettingsSectionStatus("billing"), "Not Configured");
});

test("Settings status overrides support configured and platform-managed sections", () => {
  assert.equal(
    getSettingsSectionStatus("general", { general: "Configured" }),
    "Configured",
  );
  assert.equal(
    getSettingsSectionStatus("security", { security: "Managed by Platform" }),
    "Managed by Platform",
  );
});

test("Settings labels remain section-specific and empty labels stay explicit", () => {
  assert.deepEqual(SETTINGS_LABELS_BY_SECTION.general, ["Practice identity", "Default timezone"]);
  assert.deepEqual(SETTINGS_LABELS_BY_SECTION.billing, []);
  assert.deepEqual(SETTINGS_LABELS_BY_SECTION.scheduling, []);
});

test("shared Settings page renders section status and planned configuration labels", () => {
  assert.match(settingsPageSource, /getSettingsSectionStatus/);
  assert.match(settingsPageSource, /SETTINGS_LABELS_BY_SECTION/);
  assert.match(settingsPageSource, /Settings status/);
  assert.match(settingsPageSource, /Configuration controls are not connected yet/);
});
