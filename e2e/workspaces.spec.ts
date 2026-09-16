import { expect, test } from "@playwright/test";

const workspaces = [
  { path: "/", heading: "Revenue Cycle Command Center" },
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

for (const workspace of workspaces) {
  test(`${workspace.heading} workspace renders`, async ({ page }) => {
    await page.goto(workspace.path);
    expect(new URL(page.url()).pathname).toBe(workspace.path);
    await expect(
      page.getByRole("heading", { level: 1, name: workspace.heading }),
    ).toBeVisible();
  });
}
