import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NAV_SECTIONS, getActiveItemForPath, getSectionForPath } from "../src/navigation/sections";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("global navigation promotes canonical Settings and removes Administration as an active destination", () => {
  const settings = NAV_SECTIONS.find((section) => section.id === "settings");
  assert.ok(settings);
  assert.equal(settings.primaryHref, "/settings/general");
  assert.equal(settings.children.some((item) => item.label === "Administration"), false);
  assert.equal(settings.children.some((item) => item.href === "/settings/general"), true);
  assert.equal(getSectionForPath("/settings/billing")?.id, "settings");
  assert.equal(getActiveItemForPath("/settings/billing")?.href, "/settings/general");
});

test("App wires canonical admin and member Settings routes", () => {
  assert.match(appSource, /ADMIN_SETTINGS_DEFAULT_PATH/);
  assert.match(appSource, /MEMBER_SETTINGS_DEFAULT_PATH/);
  assert.match(appSource, /path="\/settings"[\s\S]{0,120}ADMIN_SETTINGS_DEFAULT_PATH/);
  assert.match(appSource, /path="\/settings\/:rest\*"[\s\S]{0,120}SettingsPage/);
  assert.match(appSource, /path="\/member\/settings"[\s\S]{0,120}MEMBER_SETTINGS_DEFAULT_PATH/);
  assert.match(appSource, /path="\/member\/settings\/:rest\*"[\s\S]{0,120}SettingsPage/);
});

test("legacy Administration keeps technical routes but redirects the old settings destination", () => {
  assert.match(appSource, /path="\/administration\/imports"/);
  assert.match(appSource, /path="\/administration\/database-inventory"/);
  assert.match(appSource, /path="\/administration\/\*\?"[\s\S]{0,120}ADMIN_SETTINGS_DEFAULT_PATH/);
  assert.doesNotMatch(appSource, /path="\/administration"><AdministrationPage/);
});
