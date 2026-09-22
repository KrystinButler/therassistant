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

test("Work Center is the OPERATE exception workspace", async ({ page }) => {
  await page.goto("/work-center");
  await expect(page.getByRole("heading", { level: 1, name: "Work Center" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: "OPERATE", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Work Center", exact: true })).toBeVisible();
});

test("GET PAID navigation follows the product manual", async ({ page }) => {
  await page.goto("/claims");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  await expect(nav.getByRole("button", { name: "GET PAID", exact: true })).toHaveAttribute("aria-expanded", "true");
  for (const label of [
    "Charge Capture",
    "Claim Rejections",
    "Claims & 837P",
    "Denials & Appeals",
    "Payments & ERA",
  ]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  for (const removed of ["Claim Follow-Up", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(nav.getByText(removed, { exact: true })).toHaveCount(0);
  }
});

test("canonical RCM routes render the manual-aligned owning pages", async ({ page }) => {
  const routes = [
    ["/billing/charges", "Charge Capture & Claim Submission"],
    ["/rejections", "Rejections"],
    ["/claims", "Claims & A/R Follow-Up"],
    ["/denials", "Denials, Appeals & A/R"],
    ["/payments", "Payments, ERA & Reconciliation"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});
