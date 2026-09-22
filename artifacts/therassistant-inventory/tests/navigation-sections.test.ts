import test from "node:test";
import assert from "node:assert/strict";

import {
  NAV_SECTIONS,
  getActiveItemForPath,
  getNavigationContext,
  getSectionForPath,
  getVisibleSections,
  toggleExpandedSection,
} from "../src/navigation/sections";

test("primary navigation follows the product manual stage order", () => {
  assert.deepEqual(
    getVisibleSections().map((section) => section.label),
    ["ENGAGE", "PREPARE", "DOCUMENT", "GET PAID", "OPERATE", "SETTINGS"],
  );
});

test("GET PAID exposes the connected revenue-cycle operational areas", () => {
  const revenue = NAV_SECTIONS.find((section) => section.id === "get-paid");
  assert.ok(revenue);
  assert.equal(revenue.primaryHref, "/billing/charges");
  assert.deepEqual(
    revenue.children.map((item) => [item.label, item.href]),
    [
      ["Charge Capture", "/billing/charges"],
      ["Claim Rejections", "/rejections"],
      ["Claims & 837P", "/claims"],
      ["Denials & Appeals", "/denials"],
      ["Payments & ERA", "/payments"],
    ],
  );
});

test("Work Center is a first-class OPERATE destination", () => {
  const operate = NAV_SECTIONS.find((section) => section.id === "operate");
  assert.ok(operate);
  assert.equal(operate.primaryHref, "/work-center");
  assert.equal(operate.children.some((item) => item.label === "Work Center" && item.href === "/work-center"), true);
});

test("canonical revenue-cycle routes resolve to GET PAID", () => {
  const cases: Array<[string, string]> = [
    ["/billing/charges", "Charge Capture"],
    ["/rejections", "Claim Rejections"],
    ["/claims", "Claims & 837P"],
    ["/denials", "Denials & Appeals"],
    ["/payments", "Payments & ERA"],
  ];

  for (const [path, label] of cases) {
    assert.equal(getSectionForPath(path)?.id, "get-paid", path);
    assert.equal(getActiveItemForPath(path)?.label, label, path);
  }
});

test("claim detail remains contextual to Claims & 837P", () => {
  assert.equal(getSectionForPath("/claims/claim-1")?.id, "get-paid");
  assert.equal(getActiveItemForPath("/claims/claim-1")?.label, "Claims & 837P");
});

test("authorization is retired from active staff navigation", () => {
  assert.equal(getSectionForPath("/authorizations"), undefined);
  assert.equal(getActiveItemForPath("/authorizations"), undefined);
});

test("manual stage context drives accordion behavior", () => {
  const context = getNavigationContext("/denials");
  assert.equal(context.section?.label, "GET PAID");
  assert.equal(context.item?.label, "Denials & Appeals");
  assert.equal(toggleExpandedSection(null, "get-paid"), "get-paid");
  assert.equal(toggleExpandedSection("get-paid", "get-paid"), null);
  assert.equal(getVisibleSections().some((section) => section.id === "get-paid"), true);
});
