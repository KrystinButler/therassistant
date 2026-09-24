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

test("Work Center remains available in the practice navigation", async ({ page }) => {
  await page.goto("/work-center");
  await expect(page.getByRole("heading", { level: 1, name: "Work Center" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByText("PRACTICE", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Work Center", exact: true })).toBeVisible();
});

test("RCM workspaces are accessible through direct navigation links", async ({ page }) => {
  await page.goto("/claims");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  for (const [label, href] of [
    ["Charge Capture", "/billing/charges"],
    ["Claims", "/claims"],
    ["Payments", "/payments"],
  ] as const) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }

  for (const removed of ["Claim Follow-Up", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(nav.getByText(removed, { exact: true })).toHaveCount(0);
  }
});

test("canonical RCM routes render the manual-aligned owning pages", async ({ page }) => {
  const routes = [
    ["/billing/charges", "Charge Capture & Billing Routing"],
    ["/rejections", "Rejections & Validation Holds"],
    ["/claims", "Claims & A/R Follow-Up"],
    ["/denials", "Denials, Appeals & A/R"],
    ["/payments", "Payment Posting"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});
