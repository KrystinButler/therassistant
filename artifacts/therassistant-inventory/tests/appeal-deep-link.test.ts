import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppealDeepLink } from "../src/domains/ar/appeal-deep-link.ts";

const denials = [
  { id: "d1", payer_id: "p1", denial_status: "new" },
  { id: "d2", payer_id: "p1", denial_status: "new" },
  { id: "closed", payer_id: "p2", denial_status: "resolved" },
];
const appeals = [
  { id: "a1", denial_id: "d1", appeal_status: "drafting" },
  { id: "a2", denial_id: "d2", appeal_status: "pending" },
  { id: "a3", denial_id: "closed", appeal_status: "submitted" },
  { id: "a4", denial_id: "d1", appeal_status: "approved" },
  { id: "orphan", denial_id: "missing", appeal_status: "pending" },
];
test("appeal link selects the exact appeal among multiple appeals for one payer", () => {
  const selected = resolveAppealDeepLink("a2", appeals, denials);
  assert.equal(selected?.appeal, appeals[1]);
  assert.equal(selected?.denial, denials[1]);
});
test("stale links never substitute another active appeal", () => {
  for (const id of [null, "missing", "a3", "a4", "orphan"]) {
    assert.equal(resolveAppealDeepLink(id, appeals, denials), null);
  }
});

test("Denials page wires exact selection to visible row focus", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/domains/ar/DenialsPage.tsx", import.meta.url), "utf8");
  for (const expected of [
    "resolveAppealDeepLink(appealId, data.appeals, data.denials)",
    "setSelectedAppealId(appeal?.id ?? null)",
    "<AppealsTable selectedAppealId={selectedAppealId}",
    "aria-selected={row.id === selectedAppealId}",
    'document.getElementById(`appeal-${selectedAppealId}`)',
    'row?.scrollIntoView({ block: "center" })',
    "row?.focus({ preventScroll: true })",
  ]) assert.ok(page.includes(expected), expected);
});
