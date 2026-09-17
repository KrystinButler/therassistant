import { expect, test } from "@playwright/test";

test("staff routes require an authenticated session", async ({ page }) => {
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("DEMO PRACTICE")).toHaveCount(0);
  await expect(page.getByText("SYNTHETIC DEMO DATA")).toHaveCount(0);
});

test("staff login exposes no public signup control", async ({ page }) => {
  await page.goto("/clients");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign up|create account|register/i })).toHaveCount(0);
});
