import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { staffStorageState } from "../playwright.config";

setup("authenticate staff browser session", async ({ page }) => {
  const email = process.env.E2E_STAFF_EMAIL?.trim();
  const password = process.env.E2E_STAFF_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Authenticated workspace E2E requires E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD. Configure a dedicated Supabase Auth staff user with an active tenant membership and role, then add those values as GitHub Actions secrets.",
    );
  }

  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);

  await mkdir(dirname(staffStorageState), { recursive: true });
  await page.context().storageState({ path: staffStorageState });
});
