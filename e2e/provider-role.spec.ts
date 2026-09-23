import { expect, test } from "@playwright/test";

test("provider identity is clinician-scoped and linked to one synthetic provider", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible();
  await expect(page.locator(".schedule-provider-identity")).toContainText("Jamie Parker");
  await expect(page.locator(".schedule-provider-filter")).toHaveCount(0);
});
