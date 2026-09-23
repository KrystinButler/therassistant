import { expect, test } from "@playwright/test";

test("patient identity can access only the synthetic patient portal context", async ({ page }) => {
  await page.goto("/patient-portal");
  await expect(page.getByRole("heading", { name: "Jordan Ellis" })).toBeVisible();
  await expect(page.getByText("PATIENT PORTAL", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
});
