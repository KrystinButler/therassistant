import { expect, test } from "@playwright/test";

test("Settings renders a dedicated two-column configuration layout on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings/general");

  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings navigation" })).toBeVisible();

  const layout = page.locator(".thera-settings-layout");
  await expect(layout).toBeVisible();

  const display = await layout.evaluate((element) => getComputedStyle(element).display);
  expect(display).toBe("grid");

  const columns = await layout.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  const columnCount = columns.split(" ").filter(Boolean).length;
  expect(columnCount).toBeGreaterThanOrEqual(2);
});

test("Settings preserves a single document main landmark", async ({ page }) => {
  await page.goto("/settings/general");

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator(".thera-settings-content")).toBeVisible();
});
