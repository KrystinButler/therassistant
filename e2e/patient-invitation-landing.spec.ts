import { expect, test } from "@playwright/test";

const supabaseUrl = (
  process.env.E2E_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://lpjwfdvaxobewxcklenl.supabase.co"
).replace(new RegExp("/$"), "");

for (const [label, inviteType] of [
  ["invite fragment", "&type=invite"],
  ["Site URL fallback without invite fragment", ""],
] as const) {
  test(`accepted patient email invitation reaches the real portal via ${label}`, async ({ page }) => {
    const patient = {
      id: "40000000-0000-4000-8000-000000000091",
      first_name: "Taylor",
      last_name: "Synthetic",
      registration_status: "complete",
    };
    const authUser = {
      id: "00000000-0000-4000-8000-000000000091",
      email: "patient-invite-test@example.invalid",
    };
    let activated = false;
    let passwordUpdated = false;

    await page.route(`${supabaseUrl}/auth/v1/user`, async (route) => {
      if (route.request().method() === "PUT") passwordUpdated = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authUser) });
    });
    await page.route(`${supabaseUrl}/rest/v1/rpc/get_my_client_portal_context`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tenant_id: "10000000-0000-4000-8000-000000000091",
          client_id: patient.id,
          status: activated ? "active" : "invited",
          relationship: "self",
          invited_email: authUser.email,
        }),
      });
    });
    await page.route(`${supabaseUrl}/rest/v1/rpc/activate_my_client_portal_access`, async (route) => {
      if (!passwordUpdated) {
        await route.fulfill({ status: 400, body: "Password must be updated before activation." });
        return;
      }
      activated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ client_id: patient.id, status: "active" }),
      });
    });
    await page.route(`${supabaseUrl}/rest/v1/rpc/get_my_patient_portal_data`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          patient, appointments: [], insurancePolicies: [], documents: [],
          checkins: [], journalEntries: [], balance: null,
        }),
      });
    });
    await page.route(`${supabaseUrl}/rest/v1/rpc/get_my_portal_provider_summary`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });

    // Supabase may redirect a verified email invitation to its Site URL (/)
    // instead of the requested /patient-portal/activate path.
    await page.goto(
      `/#access_token=e2e-invite-token&refresh_token=e2e-invite-refresh&expires_in=3600${inviteType}`,
    );

    await expect.poll(() => new URL(page.url()).pathname).toBe("/patient-portal/activate");
    await expect(page.getByRole("heading", { name: "Activate patient portal" }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);

    await page.getByLabel("Password", { exact: true }).fill("SyntheticPassword-2026!");
    await page.getByLabel("Confirm password").fill("SyntheticPassword-2026!");
    await page.getByRole("button", { name: "Activate portal" }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe("/patient-portal");
    await expect(page.getByRole("heading", { name: "Taylor Synthetic" }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Open Journal" })).toBeVisible();
    expect(activated).toBe(true);
    expect(passwordUpdated).toBe(true);
  });
}
