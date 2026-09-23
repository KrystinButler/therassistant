import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { providerStorageState } from "../playwright.config";
import { requireSyntheticIdentityMatrix } from "./identity-contract";

setup("authenticate synthetic provider browser session", async ({ page }) => {
  const { provider } = requireSyntheticIdentityMatrix();
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(provider.email);
  await page.getByLabel("Password").fill(provider.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".schedule-provider-identity")).toContainText("Jamie Parker");
  await mkdir(dirname(providerStorageState), { recursive: true });
  await page.context().storageState({ path: providerStorageState });
});
