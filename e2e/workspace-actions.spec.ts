import { expect, test, type Page } from "@playwright/test";

async function expectWorkspace(page: Page, heading: string) {
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
}

test("Patients opens an add-patient drawer and preserves the workspace on cancel", async ({
  page,
}) => {
  const inviteRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/functions/v1/invite-patient-portal")) {
      inviteRequests.push(pathname);
    }
  });

  await page.goto("/clients");
  await page.getByRole("button", { name: "+ Add Patient" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save + Send Portal Invite" }),
  ).toBeVisible();
  await expect(
    page.getByText(/save the patient once and send their secure portal invitation/i),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Patient First Name *", exact: true }).fill("E2E");
  await page.getByRole("textbox", { name: "Patient Last Name *", exact: true }).fill("Patient");
  await expect(page.getByRole("button", { name: "Save Patient" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeHidden();
  await expectWorkspace(page, "Patients");
  expect(new URL(page.url()).pathname).toBe("/clients");
  expect(inviteRequests).toEqual([]);
});

test("Schedule opens a new-appointment drawer and returns to the schedule", async ({
  page,
}) => {
  await page.goto("/schedule");
  await page.getByRole("button", { name: "+ Appointment" }).click();
  await expect(page.getByRole("heading", { name: "New Appointment" })).toBeVisible();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("combobox", { name: "Patient", exact: true })).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Provider", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "My Schedule");
  expect(new URL(page.url()).pathname).toBe("/schedule");
});

test("Claims supports an empty production queue or opens Claim 360 when work exists", async ({ page }) => {
  await page.goto("/claims");
  await expectWorkspace(page, "Claims");
  await expect(page.getByText("Loading Claims...")).toHaveCount(0);

  const workClaims = page.getByRole("button", { name: "Work Claim" });
  if ((await workClaims.count()) === 0) {
    await expect(page.getByText("No outstanding payer claims.", { exact: true })).toBeVisible();
    return;
  }

  await workClaims.first().click();
  await page.getByRole("button", { name: "Open Full Claim 360" }).click();

  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/claims\/[^/]+$/);
  await expect(page.getByText("CLAIM 360", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Claim Submission", exact: true })).toHaveCount(0);

  await page.locator(".thera-breadcrumb").getByRole("link", { name: "Claims", exact: true }).click();
  await expectWorkspace(page, "Claims");
  expect(new URL(page.url()).pathname).toBe("/claims");
});

test("Payments opens the post-payment drawer without posting", async ({ page }) => {
  await page.goto("/payments");
  await page.getByRole("button", { name: "+ Post Payment" }).click();
  await expect(page.getByRole("heading", { name: "Post Payment" })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("10.00");
  await expect(page.getByRole("button", { name: "Post Payment" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Payment Posting");
});

test("Credentialing uses production data access and opens enrollment work when records exist", async ({
  page,
}) => {
  const retiredRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/credentialing/")) retiredRequests.push(pathname);
  });

  await page.goto("/credentialing");
  await expectWorkspace(page, "Credentialing");
  await expect(page.getByText("Loading credentialing...")).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Provider", exact: true }),
  ).toBeVisible();
  expect(retiredRequests).toEqual([]);

  const edits = page.getByRole("button", { name: "Edit Enrollment" });
  if ((await edits.count()) === 0) return;

  await edits.first().click();
  await expect(page.getByRole("heading", { name: "Edit Enrollment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Enrollment" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Credentialing");
});


test("Providers opens an add-provider drawer without saving", async ({ page }) => {
  await page.goto("/providers");
  await page.getByRole("button", { name: "+ Add Provider" }).click();
  await expect(page.getByRole("heading", { name: "Add Provider" })).toBeVisible();
  await page.getByLabel("First Name").fill("E2E");
  await page.getByLabel("Last Name").fill("Provider");
  await expect(page.getByRole("button", { name: "Save Provider" })).toBeEnabled();
  // The redesigned form requires confirmation before discarding dirty inputs.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Add Provider" })).toBeHidden();
  await expectWorkspace(page, "Providers");
});

test("Eligibility attention filter toggles without navigation", async ({ page }) => {
  await page.goto("/eligibility");
  const needsAttention = page.getByRole("button", {
    name: /^Needs Attention \(\d+\)$/,
  });
  await expect(needsAttention).toBeVisible();
  await needsAttention.click();
  await expect(page.getByRole("button", { name: "Show All" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/eligibility");
  await expectWorkspace(page, "Eligibility");
});

test("retired Authorizations route redirects to Eligibility", async ({ page }) => {
  await page.goto("/authorizations");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/eligibility");
  await expectWorkspace(page, "Eligibility");
});
