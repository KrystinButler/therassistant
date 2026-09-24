import { expect, test } from "@playwright/test";

const routes = [
  { path: "/clients", heading: "Patients" },
  { path: "/schedule", heading: "My Schedule" },
  { path: "/claims", heading: "Claims & A/R Follow-Up" },
  { path: "/payments", heading: "Payment Posting" },
  { path: "/eligibility", heading: "Eligibility" },
  { path: "/credentialing", heading: "Credentialing" },
  { path: "/providers", heading: "Providers" },
  { path: "/payers-contracts", heading: "Payers & Contracts" },
] as const;

for (const route of routes) {
  test(`${route.heading} route renders`, async ({ page }) => {
    await page.goto(route.path);
    expect(new URL(page.url()).pathname).toBe(route.path);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading, exact: true }),
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

test("provider root opens the connected workflow home", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 2, name: "Today's Schedule" })).toBeVisible();
  await expect(page.getByLabel("Practice summary")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  for (const label of ["Dashboard", "Appointments", "Clients", "Clinical Notes", "Charge Capture", "Claims", "Payments"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});

test("Direct navigation exposes the revenue-cycle workspaces", async ({ page }) => {
  await page.goto("/claims");
  await expect(page.getByRole("heading", { level: 1, name: "Claims & A/R Follow-Up", exact: true })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  for (const [label, href] of [
    ["Charge Capture", "/billing/charges"],
    ["Claims", "/claims"],
    ["Payments", "/payments"],
  ] as const) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }

  await expect(nav.getByText("Command Center", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Claim Submission / 837P", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/operational workspace/i)).toHaveCount(0);
});
