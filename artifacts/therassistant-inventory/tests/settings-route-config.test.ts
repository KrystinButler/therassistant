import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_SETTINGS_DEFAULT_PATH,
  ADMIN_SETTINGS_GROUPS,
  ADMIN_SETTINGS_ROOT,
  MEMBER_SETTINGS_DEFAULT_PATH,
  MEMBER_SETTINGS_GROUPS,
  MEMBER_SETTINGS_ROOT,
  SETTINGS_GROUP_ORDER,
} from "../src/domains/settings/route-config";
import { settingsRouteBySlug } from "../src/domains/settings/model";

test("settings roots use the approved canonical defaults", () => {
  assert.equal(ADMIN_SETTINGS_ROOT, "/settings");
  assert.equal(ADMIN_SETTINGS_DEFAULT_PATH, "/settings/general");
  assert.equal(MEMBER_SETTINGS_ROOT, "/member/settings");
  assert.equal(MEMBER_SETTINGS_DEFAULT_PATH, "/member/settings/my-account");
});

test("admin settings sidebar uses the approved group order", () => {
  assert.deepEqual(SETTINGS_GROUP_ORDER, [
    "Practice",
    "Care Delivery",
    "Revenue Cycle",
    "Engagement",
    "Platform",
    "Preferences",
  ]);

  assert.deepEqual(
    ADMIN_SETTINGS_GROUPS.map((group) => group.label),
    SETTINGS_GROUP_ORDER,
  );

  assert.equal(
    ADMIN_SETTINGS_GROUPS.flatMap((group) => group.items).length,
    19,
  );
});

test("billing and scheduling routes come from the canonical settings model", () => {
  const revenueCycle = ADMIN_SETTINGS_GROUPS.find((group) => group.label === "Revenue Cycle");
  const careDelivery = ADMIN_SETTINGS_GROUPS.find((group) => group.label === "Care Delivery");

  assert.equal(
    revenueCycle?.items.find((item) => item.slug === "billing")?.path,
    settingsRouteBySlug.billing.path,
  );
  assert.equal(
    careDelivery?.items.find((item) => item.slug === "scheduling")?.path,
    settingsRouteBySlug.scheduling.path,
  );
});

test("member settings expose Preferences / My Account only", () => {
  assert.deepEqual(
    MEMBER_SETTINGS_GROUPS.map((group) => [
      group.label,
      group.items.map((item) => [item.label, item.path]),
    ]),
    [["Preferences", [["My Account", "/member/settings/my-account"]]]],
  );

  assert.equal(
    MEMBER_SETTINGS_GROUPS.flatMap((group) => group.items).some((item) => item.label === "Billing"),
    false,
  );
});
