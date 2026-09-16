import { expect, test, type Page } from "@playwright/test";

async function expectWorkspace(page: Page, heading: string) {
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
}

test("Patients opens an add-patient drawer and preserves the workspace on cancel", async ({
  page,
}) => {
  await page.goto("/clients");
  await page.getByRole("button", { name: "+ Add Patient" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeVisible();
  await page.getByLabel("First Name").fill("E2E");
  await page.getByLabel("Last Name").fill("Patient");
  await expect(page.getByRole("button", { name: "Save Patient" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeHidden();
  await expectWorkspace(page, "Patients");
  expect(new URL(page.url()).pathname).toBe("/clients");
});

test("Schedule opens a new-appointment drawer and returns to the schedule", async ({
  page,
}) => {
  await page.goto("/schedule");
  await page.getByRole("button", { name: "+ New Appointment" }).click();
  await expect(page.getByRole("heading", { name: "New Appointment" })).toBeVisible();
  await expect(page.getByLabel("Patient")).toBeVisible();
  await expect(page.getByLabel("Provider")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Schedule");
  expect(new URL(page.url()).pathname).toBe("/schedule");
});

test("Claims opens claim work from the claims list and returns to the queue", async ({
  page,
}) => {
  await page.goto("/claims");
  await page.getByRole("button", { name: "Claims List" }).click();
  const firstRow = page.getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  await firstRow.getByRole("button").first().click();
  await expect(page.getByRole("tab", { name: "Claim Fields" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & Revalidate" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("tab", { name: "Claim Fields" })).toBeHidden();
  await expectWorkspace(page, "Claims");
});

test("Payments opens the post-payment drawer without posting", async ({ page }) => {
  await page.goto("/payments");
  await page.getByRole("button", { name: "+ Post Payment" }).click();
  await expect(page.getByRole("heading", { name: "Post Payment" })).toBeVisible();
  await page.getByLabel("Amount").fill("10.00");
  await expect(page.getByRole("button", { name: "Post Payment" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Payments");
});

test("Credentialing opens enrollment work and returns without changing the enrollment", async ({
  page,
}) => {
  await page.goto("/credentialing");
  const edit = page.getByRole("button", { name: "Edit Enrollment" }).first();
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole("heading", { name: "Edit Enrollment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Enrollment" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Credentialing");
});

test("Mailroom opens add-correspondence work without saving", async ({ page }) => {
  await page.goto("/mailroom");
  await page.getByRole("button", { name: "+ Add Correspondence" }).click();
  await expect(page.getByRole("heading", { name: "Add Correspondence" })).toBeVisible();
  await page.getByLabel("Subject").fill("E2E correspondence check");
  await expect(page.getByRole("button", { name: "Save Correspondence" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Mailroom");
});

test("Providers opens an add-provider drawer without saving", async ({ page }) => {
  await page.goto("/providers");
  await page.getByRole("button", { name: "+ Add Provider" }).click();
  await expect(page.getByRole("heading", { name: "Add Provider" })).toBeVisible();
  await page.getByLabel("First Name").fill("E2E");
  await page.getByLabel("Last Name").fill("Provider");
  await expect(page.getByRole("button", { name: "Save Provider" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Providers");
});

for (const workspace of [
  { path: "/eligibility", heading: "Eligibility" },
  { path: "/authorizations", heading: "Authorizations" },
] as const) {
  test(`${workspace.heading} attention filter toggles without navigation`, async ({
    page,
  }) => {
    await page.goto(workspace.path);
    const needsAttention = page.getByRole("button", {
      name: /^Needs Attention \(\d+\)$/,
    });
    await expect(needsAttention).toBeVisible();
    await needsAttention.click();
    await expect(page.getByRole("button", { name: "Show All" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(workspace.path);
    await expectWorkspace(page, workspace.heading);
  });
}
