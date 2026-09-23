import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { patientStorageState } from "../playwright.config";
import { requireSyntheticIdentityMatrix } from "./identity-contract";

setup("authenticate synthetic patient browser session", async ({ page }) => {
  const { patient } = requireSyntheticIdentityMatrix();
  await page.goto("/patient-portal/login");
  await expect(page.getByRole("heading", { name: "Patient portal sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(patient.email);
  await page.getByLabel("Password").fill(patient.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/patient-portal");
  await expect(page.getByRole("heading", { name: "Jordan Ellis" })).toBeVisible({ timeout: 15_000 });
  await mkdir(dirname(patientStorageState), { recursive: true });
  await page.context().storageState({ path: patientStorageState });
});
