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

test("Revenue Cycle exposes exactly the five approved operational areas", () => {
  const revenue = NAV_SECTIONS.find((section) => section.id === "revenue-cycle");
  assert.ok(revenue);
  assert.equal(revenue.primaryHref, "/billing/charges");
  assert.deepEqual(
    revenue.children.map((item) => [item.label, item.href]),
    [
      ["Charges", "/billing/charges"],
      ["Rejections", "/rejections"],
      ["Claims", "/claims"],
      ["Denials", "/denials"],
      ["Payments", "/payments"],
    ],
  );
});

test("retired revenue-cycle workflow labels are absent from navigation", () => {
  const labels = NAV_SECTIONS.flatMap((section) => [section.label, ...section.children.map((item) => item.label)]);
  for (const retired of ["Work Center", "Claim Follow-Up", "Claim Submission / 837P", "A/R & Denials", "Billing Overview"]) {
    assert.equal(labels.includes(retired), false, retired);
  }
});

test("canonical revenue-cycle routes resolve to the correct item", () => {
  const cases: Array<[string, string]> = [
    ["/billing/charges", "Charges"],
    ["/rejections", "Rejections"],
    ["/claims", "Claims"],
    ["/denials", "Denials"],
    ["/payments", "Payments"],
  ];

  for (const [path, label] of cases) {
    assert.equal(getSectionForPath(path)?.id, "revenue-cycle", path);
    assert.equal(getActiveItemForPath(path)?.label, label, path);
  }
});

test("claim detail remains contextual to Claims", () => {
  assert.equal(getSectionForPath("/claims/claim-1")?.id, "revenue-cycle");
  assert.equal(getActiveItemForPath("/claims/claim-1")?.label, "Claims");
});

test("authorization remains a reference page outside Revenue Cycle workqueues", () => {
  assert.equal(getSectionForPath("/authorizations")?.id, "care-delivery");
  assert.equal(getActiveItemForPath("/authorizations")?.label, "Authorizations");
});

test("section context and accordion behavior replace workspace terminology", () => {
  const context = getNavigationContext("/denials");
  assert.equal(context.section?.label, "Revenue Cycle");
  assert.equal(context.item?.label, "Denials");
  assert.equal(toggleExpandedSection(null, "revenue-cycle"), "revenue-cycle");
  assert.equal(toggleExpandedSection("revenue-cycle", "revenue-cycle"), null);
  assert.equal(getVisibleSections().some((section) => section.id === "revenue-cycle"), true);
});

test("provider navigation does not expose an Overview or Home destination", () => {
  assert.equal(NAV_SECTIONS.some((section) => section.id === "overview"), false);
  assert.equal(
    getVisibleSections().some((section) => section.children.some((item) => item.label === "Home")),
    false,
  );
});
