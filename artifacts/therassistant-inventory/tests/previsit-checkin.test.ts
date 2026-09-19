import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const appUrl = new URL("../src/App.tsx", import.meta.url);
const checkInPageUrl = new URL("../src/domains/portal/PatientCheckInPage.tsx", import.meta.url);

test("patient portal exposes an authenticated appointment-specific pre-visit check-in route", () => {
  const appSource = readFileSync(appUrl, "utf8");
  assert.match(appSource, /patient-portal\/check-in\/:appointmentId/);
  assert.doesNotMatch(appSource, /patient-portal\/:clientId/i);
  assert.match(appSource, /PatientPortalGate/);
});

test("pre-visit responses preserve unrelated check-in data and record submission", async () => {
  const workflow = await import("../src/domains/portal/workflow.ts");
  assert.equal("buildPreVisitResponses" in workflow, true);

  const buildPreVisitResponses = (workflow as Record<string, unknown>).buildPreVisitResponses as (
    existing: Record<string, unknown>,
    update: Record<string, unknown>,
    now: Date,
  ) => Record<string, unknown>;

  const result = buildPreVisitResponses(
    { kiosk: { language: "en" }, pre_visit: { demographics_confirmed: true } },
    {
      visit_questions: { focus_today: "Manage anxiety" },
      submitted: true,
    },
    new Date("2026-09-16T20:00:00Z"),
  );

  assert.deepEqual(result.kiosk, { language: "en" });
  assert.deepEqual((result.pre_visit as Record<string, unknown>).visit_questions, { focus_today: "Manage anxiety" });
  assert.equal((result.pre_visit as Record<string, unknown>).demographics_confirmed, true);
  assert.equal((result.pre_visit as Record<string, unknown>).submitted_at, "2026-09-16T20:00:00.000Z");
});

test("pre-visit page includes the five approved workflow sections", () => {
  assert.equal(existsSync(checkInPageUrl), true);
  const source = readFileSync(checkInPageUrl, "utf8");
  for (const label of ["Demographics", "Insurance", "Visit Questions", "Consents & Acknowledgments", "Review & Submit"]) {
    assert.match(source, new RegExp(label.replace(/[&]/g, "\\&")));
  }
});
