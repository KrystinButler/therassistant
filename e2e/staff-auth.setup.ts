import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { staffStorageState } from "../playwright.config";
import { requireSyntheticIdentityMatrix } from "./identity-contract";

setup("authenticate synthetic staff browser session", async ({ page }) => {
  const { staff } = requireSyntheticIdentityMatrix();
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(staff.email);
  await page.getByLabel("Password").fill(staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  await mkdir(dirname(staffStorageState), { recursive: true });
  await page.context().storageState({ path: staffStorageState });
});
