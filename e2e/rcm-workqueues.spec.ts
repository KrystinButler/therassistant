import { expect, test } from "@playwright/test";

const redirects = [
  ["/charges", "/billing/charges"],
  ["/claims/submission", "/billing/charges"],
  ["/claims/follow-up", "/claims"],
  ["/ar-denials", "/denials"],
] as const;

for (const [legacy, target] of redirects) {
  test(`${legacy} redirects to ${target}`, async ({ page }) => {
    await page.goto(legacy);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
  });
}

test("Work Center remains an operational exception workspace", async ({ page }) => {
  await page.goto("/work-center");
  await expect(page.getByRole("heading", { level: 1, name: "Work Center" })).toBeVisible();
});

test("Revenue Cycle navigation has the five canonical links", async ({ page }) => {
  await page.goto("/claims");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  for (const label of ["Charges", "Rejections", "Claims", "Denials", "Payments"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  for (const removed of ["Work Center", "Claim Follow-Up", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(nav.getByText(removed, { exact: true })).toHaveCount(0);
  }
});

test("canonical RCM routes render their owning pages", async ({ page }) => {
  const routes = [
    ["/billing/charges", "Charges"],
    ["/rejections", "Rejections"],
    ["/claims", "Claims"],
    ["/denials", "Denials"],
    ["/payments", "Payments"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});
