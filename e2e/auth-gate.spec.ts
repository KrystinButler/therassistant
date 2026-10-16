import { expect, test } from "@playwright/test";

test("staff routes require an authenticated session", async ({ page }) => {
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByText("DEMO PRACTICE")).toHaveCount(0);
  await expect(page.getByText("SYNTHETIC DEMO DATA")).toHaveCount(0);
});

test("staff login exposes password recovery but no public signup control", async ({ page }) => {
  await page.goto("/clients");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign up|create account|register/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign up|create account|register/i })).toHaveCount(0);
});

test("successful staff login leaves the login route for the dashboard", async ({ page }) => {
  const supabaseUrl =
    process.env.E2E_SUPABASE_URL?.replace(/\/$/, "") ??
    "https://lpjwfdvaxobewxcklenl.supabase.co";
  const userId = "00000000-0000-4000-8000-000000000091";
  const tenantId = "00000000-0000-4000-8000-000000000092";

  await page.route(`${supabaseUrl}/auth/v1/token?grant_type=password`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "staff-login-test-token",
        refresh_token: "staff-login-test-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: userId, email: "staff-login@example.invalid" },
      }),
    });
  });

  await page.route(`${supabaseUrl}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith("/rpc/get_my_client_portal_context")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      return;
    }
    if (path.endsWith("/tenant_users")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ tenant_id: tenantId, status: "active", created_at: "2026-10-16T00:00:00Z" }]),
      });
      return;
    }
    if (path.endsWith("/tenants")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: tenantId, name: "Login Test Practice", timezone: "America/Denver", status: "active" }]),
      });
      return;
    }
    if (path.endsWith("/tenant_user_roles")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ role: "practice_admin" }]),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("staff-login@example.invalid");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(page.getByText("Page not found.")).toHaveCount(0);
});

test("Supabase recovery callback opens password update before tenant access", async ({ page }) => {
  const supabaseUrl =
    process.env.E2E_SUPABASE_URL?.replace(/\/$/, "") ??
    "https://lpjwfdvaxobewxcklenl.supabase.co";

  await page.route(`${supabaseUrl}/auth/v1/user`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000028",
          email: "recovery-test@example.invalid",
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/#access_token=e2e-recovery-token&refresh_token=e2e-refresh-token&type=recovery&expires_in=3600");

  await expect(page.getByRole("heading", { name: "Set new password" })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirm new password", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
});


test("patient portal home requires a patient session", async ({ page }) => {
  await page.goto("/patient-portal");

  await expect(
    page.getByRole("heading", { name: "Patient portal sign in" }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/patient-portal/login");
  await expect(page.getByRole("button", { name: /sign up|create account|register/i })).toHaveCount(0);
});
