import { expect, test } from "@playwright/test";

const APPOINTMENT_ID = "50000000-0000-4000-8000-000000000001";
const CHECKIN_ID = "e5000000-0000-4000-8000-000000000001";

test("submitted pre-visit check-in starts the managed embedded video session", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("therassistant.auth.session.v1", JSON.stringify({
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      flowType: null,
      user: { id: "f0000000-0000-4000-8000-000000000001", email: "jordan@example.test" },
    }));
  });

  await page.route("**/auth/v1/user", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "f0000000-0000-4000-8000-000000000001", email: "jordan@example.test" }),
  }));
  await page.route("**/rest/v1/rpc/get_my_client_portal_context", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      tenant_id: "10000000-0000-4000-8000-000000000001",
      client_id: "40000000-0000-4000-8000-000000000001",
      status: "active",
      relationship: "self",
      invited_email: "jordan@example.test",
    }),
  }));
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  startsAt.setMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 53 * 60 * 1000);
  const savedAt = new Date().toISOString();
  const submittedAt = new Date(Date.now() + 1_000).toISOString();

  const visitQuestions = {
    screeners: {
      phq9: Array(9).fill(0),
      gad7: Array(7).fill(0),
      cssrs: [false, false, null, null, null, false, null],
    },
    focus_today: "Sleep and anxiety",
    feeling_since_last_visit: "About the same",
    important_changes: "No major changes",
    safety_concerns: "No new concerns",
    treatment_goal: "Improve sleep consistency",
    somatic_distress_score: 2,
    anything_else: "Ready for the visit",
  };
  const consents = {
    information_accurate: true,
    privacy_acknowledged: true,
    care_acknowledged: true,
  };
  const checkin = {
    id: CHECKIN_ID,
    appointment_id: APPOINTMENT_ID,
    responses: {
      pre_visit: {
        demographics_confirmed: true,
        insurance_confirmed: true,
        visit_questions: visitQuestions,
        visit_questions_saved_at: savedAt,
        consents,
        consents_saved_at: savedAt,
      },
    },
  };

  await page.route("**/rest/v1/rpc/get_my_patient_portal_data", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        patient: {
          id: "40000000-0000-4000-8000-000000000001",
          first_name: "Jordan",
          last_name: "Ellis",
          date_of_birth: "1990-01-15",
          phone: "303-555-0101",
          email: "jordan@example.test",
        },
        appointments: [{
          id: APPOINTMENT_ID,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          appointment_status: "scheduled",
          location_type: "telehealth",
          service_type: "Individual Therapy",
        }],
        insurancePolicies: [],
        documents: [],
        checkins: [checkin],
        journalEntries: [],
        balance: null,
        treatmentGoals: [{ id: "goal-1", goal_text: "Improve sleep consistency" }],
      }),
    });
  });
  await page.route("**/rest/v1/rpc/get_my_portal_provider_summary", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/rest/v1/rpc/get_my_portal_billing_summary", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ open_balance_cents: 0, payments: [] }) }));

  let submittedUpdate: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/rpc/portal_save_previsit_checkin", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, any>;
    submittedUpdate = requestBody.p_update ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...checkin,
        responses: {
          pre_visit: {
            ...checkin.responses.pre_visit,
            ...(requestBody.p_update ?? {}),
            submitted_at: submittedAt,
          },
        },
      }),
    });
  });

  let telehealthRequested = false;
  await page.route(`**/api/telehealth/appointments/${APPOINTMENT_ID}/session`, async (route) => {
    telehealthRequested = true;
    expect(submittedUpdate?.submitted).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "ready",
        provider: "daily",
        participant: "patient",
        roomUrl: "https://therassistant.daily.co/thera-e2e-room",
        meetingToken: "synthetic-daily-token",
        expiresAt: new Date(endsAt.getTime() + 30 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.route("**/@daily-co_daily-js.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        const Daily = {
          createFrame(container) {
            const marker = document.createElement('div');
            marker.dataset.testid = 'daily-mock-frame';
            marker.textContent = 'Synthetic embedded video connected';
            container.appendChild(marker);
            const handlers = {};
            return {
              on(name, handler) { handlers[name] = handler; return this; },
              async join(input) { window.__therassistantDailyJoin = input; return {}; },
              async leave() {},
              async destroy() {},
            };
          },
        };
        export default Daily;
      `,
    });
  });

  await page.goto(`/patient-portal/check-in/${APPOINTMENT_ID}`);
  await expect(page.getByRole("heading", { name: "Pre-Visit Check-In" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Complete pre-visit check-in to join.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review & Submit" }).click();
  const submit = page.getByRole("button", { name: "Submit Pre-Visit Check-In" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect.poll(() => telehealthRequested).toBe(true);
  await expect(page.getByText("Video visit ready", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("daily-mock-frame")).toHaveText("Synthetic embedded video connected");
  await expect.poll(() => page.evaluate(() => (window as any).__therassistantDailyJoin ?? null)).toEqual({
    url: "https://therassistant.daily.co/thera-e2e-room",
    token: "synthetic-daily-token",
  });
});