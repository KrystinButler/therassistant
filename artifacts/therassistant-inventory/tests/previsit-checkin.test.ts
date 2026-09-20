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

test("provider patient review prioritizes submitted pre-visit visit questions", async () => {
  const model = await import("../src/domains/scheduling/patient-review-model.ts");
  assert.equal("buildPatientReviewCheckIn" in model, true);

  const buildPatientReviewCheckIn = (model as Record<string, unknown>).buildPatientReviewCheckIn as (
    checkin: Record<string, unknown>,
  ) => {
    focus: string;
    mood: string;
    changes: string[];
    treatmentGoal: string;
    additionalContext: string;
    safetyText: string;
    safetyConcern: boolean | null;
  };

  const result = buildPatientReviewCheckIn({
    focus_today: "Legacy focus",
    mood: "Legacy mood",
    recent_changes: "Legacy change",
    responses: {
      pre_visit: {
        submitted_at: "2026-09-16T20:00:00.000Z",
        visit_questions: {
          focus_today: "Manage anxiety before work meetings",
          feeling_since_last_visit: "More stable this week",
          important_changes: "Increased work stress; Better sleep this week",
          safety_concerns: "No safety concerns",
          treatment_goal: "Use coping skills before difficult meetings",
          anything_else: "Please ask about medication side effects",
        },
      },
    },
  });

  assert.equal(result.focus, "Manage anxiety before work meetings");
  assert.equal(result.mood, "More stable this week");
  assert.deepEqual(result.changes, ["Increased work stress", "Better sleep this week"]);
  assert.equal(result.treatmentGoal, "Use coping skills before difficult meetings");
  assert.equal(result.additionalContext, "Please ask about medication side effects");
  assert.equal(result.safetyText, "No safety concerns");
  assert.equal(result.safetyConcern, false);
});

test("provider patient review ignores incomplete pre-visit drafts and preserves legacy check-in fallback", async () => {
  const { buildPatientReviewCheckIn } = await import("../src/domains/scheduling/patient-review-model.ts");
  const result = buildPatientReviewCheckIn({
    focus_today: "Legacy focus",
    mood: "Legacy mood",
    recent_changes: "Legacy change",
    responses: {
      pre_visit: {
        visit_questions: {
          focus_today: "Unsubmitted draft focus",
          feeling_since_last_visit: "Unsubmitted draft mood",
        },
      },
    },
  });

  assert.equal(result.focus, "Legacy focus");
  assert.equal(result.mood, "Legacy mood");
  assert.deepEqual(result.changes, ["Legacy change"]);
  assert.equal(result.hasSubmittedPreVisit, false);
});

test("provider patient review maps submitted safety responses and legacy fallback", async () => {
  const { buildPatientReviewCheckIn } = await import("../src/domains/scheduling/patient-review-model.ts");

  const concern = buildPatientReviewCheckIn({
    responses: {
      pre_visit: {
        submitted_at: "2026-09-16T20:00:00.000Z",
        visit_questions: { safety_concerns: "I have had thoughts of hurting myself this week." },
      },
    },
  });
  assert.equal(concern.safetyConcern, true);
  assert.equal(concern.safetyText, "I have had thoughts of hurting myself this week.");

  const noConcern = buildPatientReviewCheckIn({
    responses: {
      pre_visit: {
        submitted_at: "2026-09-16T20:00:00.000Z",
        visit_questions: { safety_concerns: "No safety concerns" },
      },
    },
  });
  assert.equal(noConcern.safetyConcern, false);

  const emptySubmitted = buildPatientReviewCheckIn({
    responses: {
      pre_visit: {
        submitted_at: "2026-09-16T20:00:00.000Z",
        visit_questions: { safety_concerns: "" },
      },
    },
  });
  assert.equal(emptySubmitted.safetyConcern, null);

  const legacy = buildPatientReviewCheckIn({ safety_concerns: false });
  assert.equal(legacy.safetyConcern, false);

  const neutral = buildPatientReviewCheckIn({});
  assert.equal(neutral.safetyConcern, null);
});
