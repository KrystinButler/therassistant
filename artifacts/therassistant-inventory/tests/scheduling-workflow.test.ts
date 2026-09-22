import test from "node:test";
import assert from "node:assert/strict";

import * as schedulingWorkflow from "../src/domains/scheduling/workflow.ts";

const {
  buildAppointmentInput,
} = schedulingWorkflow;

type SchedulePresentation = {
  checkInStatus: "Not Checked In" | "Ready" | "In Progress" | "Balance Issues";
  preVisitInsights: Array<{ label: string; value: string; tone: "positive" | "warning" | "neutral" }>;
  sessionFocus: string | null;
};

type PresentationBuilder = (
  checkin: Record<string, unknown> | null,
  balanceIssue: boolean,
  journalShared?: boolean,
) => SchedulePresentation;

const buildSchedulePatientPresentation = (
  schedulingWorkflow as typeof schedulingWorkflow & {
    buildSchedulePatientPresentation?: PresentationBuilder;
  }
).buildSchedulePatientPresentation;

test("appointment input derives workflow context instead of accepting insurance foreign keys", () => {
  const input = buildAppointmentInput({
    clientId: "client-1",
    providerId: "provider-1",
    date: "2026-09-15",
    time: "10:00",
    durationMinutes: 60,
    locationType: "telehealth",
    serviceType: "Individual Therapy",
    cptCode: "90837",
  });

  assert.equal(input.client_id, "client-1");
  assert.equal(input.provider_id, "provider-1");
  assert.equal(input.appointment_status, "scheduled");
  assert.equal("insurance_policy_id" in input, false);
  assert.equal("payer_id" in input, false);
  assert.equal(
    new Date(input.ends_at).getTime() - new Date(input.starts_at).getTime(),
    60 * 60 * 1000,
  );
});

test("schedule check-in status is restricted to the four approved states", () => {
  const build = buildSchedulePatientPresentation;

  assert.equal(build?.(null, false).checkInStatus, "Not Checked In");
  assert.equal(
    build?.({ responses: { pre_visit: { updated_at: "2026-09-17T08:00:00Z" } } }, false).checkInStatus,
    "In Progress",
  );
  assert.equal(
    build?.({ responses: { pre_visit: { submitted_at: "2026-09-17T08:05:00Z" } } }, false).checkInStatus,
    "Ready",
  );
  assert.equal(
    build?.({ responses: { pre_visit: { submitted_at: "2026-09-17T08:05:00Z" } } }, true).checkInStatus,
    "Balance Issues",
  );
});

test("pre-visit insight is limited to positive or negative signal plus journal-shared status", () => {
  const presentation = buildSchedulePatientPresentation?.({
    responses: {
      pre_visit: {
        submitted_at: "2026-09-17T08:05:00Z",
        visit_questions: {
          focus_today: "Work on sleep and racing thoughts",
          feeling_since_last_visit: "More anxious this week",
          important_changes: "Started a new job",
          safety_concerns: "None",
          treatment_goal: "Use grounding skills more consistently",
          anything_else: "No additional concerns",
        },
      },
    },
  }, false, true);

  assert.ok(presentation);
  assert.equal(presentation.sessionFocus, "Work on sleep and racing thoughts");
  assert.deepEqual(presentation.preVisitInsights, [
    { label: "Check-In", value: "Negative", tone: "warning" },
    { label: "Journal", value: "Shared", tone: "neutral" },
  ]);
  assert.equal(
    presentation.preVisitInsights.some((insight) => insight.value === presentation.sessionFocus),
    false,
  );
});
