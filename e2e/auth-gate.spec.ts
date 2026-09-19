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

test("Supabase recovery callback opens password update before tenant access", async ({ page }) => {
  await page.route("https://lpjwfdvaxobewxcklenl.supabase.co/auth/v1/user", async (route) => {
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
