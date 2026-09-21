import { expect, test } from "@playwright/test";

const routes = [
  { path: "/clients", heading: "Patients" },
  { path: "/schedule", heading: "Schedule" },
  { path: "/claims", heading: "Claims" },
  { path: "/payments", heading: "Payments" },
  { path: "/eligibility", heading: "Eligibility" },
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

test("retired Authorizations route resolves to Eligibility", async ({ page }) => {
  await page.goto("/authorizations");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/eligibility");
  await expect(
    page.getByRole("heading", { level: 1, name: "Eligibility" }),
  ).toBeVisible();
});


test("provider root redirects to Schedule and does not expose Overview or Home", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "My Schedule" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);
});

test("production Revenue Cycle navigation exposes canonical workqueues without retired labels", async ({ page }) => {
  await page.goto("/claims");
  await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: /Revenue Cycle/ })).toHaveAttribute("aria-expanded", "true");

  for (const label of ["Charges", "Rejections", "Claims", "Denials", "Payments"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await expect(nav.getByText("Command Center", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Work Center", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Claim Submission / 837P", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/operational workspace/i)).toHaveCount(0);
});
