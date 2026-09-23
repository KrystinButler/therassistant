import { expect, test } from "@playwright/test";

test("staff identity has administrative schedule scope", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible();
  await expect(page.locator(".schedule-provider-filter")).toBeVisible();
  await expect(page.locator(".schedule-provider-identity")).toHaveCount(0);
});
