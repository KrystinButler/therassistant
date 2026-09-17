import { expect, test } from "@playwright/test";

const routes = [
  { path: "/clients", heading: "Patients" },
  { path: "/schedule", heading: "Schedule" },
  { path: "/claims", heading: "Claims" },
  { path: "/payments", heading: "Payments" },
  { path: "/eligibility", heading: "Eligibility" },
  { path: "/authorizations", heading: "Authorizations" },
  { path: "/credentialing", heading: "Credentialing" },
  { path: "/mailroom", heading: "Mailroom" },
  { path: "/providers", heading: "Providers" },
  { path: "/payers-contracts", heading: "Payers & Contracts" },
] as const;

for (const route of routes) {
  test(`${route.heading} route renders`, async ({ page }) => {
    await page.goto(route.path);
    expect(new URL(page.url()).pathname).toBe(route.path);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
  });
}

test("provider root redirects to Schedule and does not expose Overview or Home", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "My Schedule" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);
});

test("demo exposes canonical RCM workqueues without retired center or workflow labels", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { level: 1, name: "Therassistant Phase 1 Demo" })).toBeVisible();

  for (const label of ["Charges", "Rejections", "Claims", "Denials", "Payments"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await expect(page.getByText("Command Center", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Work Center", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Claim Submission / 837P", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/operational workspace/i)).toHaveCount(0);
});
