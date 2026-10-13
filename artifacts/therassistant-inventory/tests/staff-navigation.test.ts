import test from "node:test";
import assert from "node:assert/strict";

import {
  STAFF_NAVIGATION,
  getActiveStaffNavigationItem,
} from "../src/navigation/staff-navigation.ts";

test("staff navigation is organized around care, revenue cycle, practice, and administration", () => {
  assert.deepEqual(
    STAFF_NAVIGATION.map((group) => group.label),
    ["HOME", "REVENUE CYCLE", "PRACTICE", "ADMINISTRATION"],
  );

  assert.deepEqual(
    STAFF_NAVIGATION[0].items.map((item) => [item.label, item.href]),
    [
      ["Dashboard", "/"],
      ["Schedule", "/schedule"],
      ["Patients", "/clients"],
      ["Clinical", "/clinical"],
    ],
  );

  assert.deepEqual(
    STAFF_NAVIGATION[1].items.map((item) => [item.label, item.href]),
    [
      ["Charges", "/billing/charges"],
      ["Claims", "/claims"],
      ["Payments", "/payments"],
      ["Denials", "/denials"],
    ],
  );
});

test("context routes keep the correct navigation item active", () => {
  assert.equal(getActiveStaffNavigationItem("/encounters/enc-1")?.label, "Clinical");
  assert.equal(getActiveStaffNavigationItem("/clients/client-1")?.label, "Patients");
  assert.equal(getActiveStaffNavigationItem("/claims/claim-1")?.label, "Claims");
  assert.equal(getActiveStaffNavigationItem("/rejections")?.label, "Claims");
  assert.equal(getActiveStaffNavigationItem("/administration/users")?.label, "Users & Roles");
  assert.equal(getActiveStaffNavigationItem("/organization-setup")?.label, "Practice Setup");
});

test("practice and administration destinations remain first-class", () => {
  assert.deepEqual(
    STAFF_NAVIGATION[2].items.map((item) => item.label),
    ["Providers", "Credentialing", "Messaging", "Patient Portal", "Reports", "Work Center"],
  );
  assert.deepEqual(
    STAFF_NAVIGATION[3].items.map((item) => item.label),
    ["Practice Setup", "Users & Roles", "Imports", "Audit", "Settings"],
  );
});
