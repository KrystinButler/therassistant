import { expect, test } from "@playwright/test";

const APPOINTMENT_ID = "50000000-0000-4000-8000-000000000001";

test("provider completes a synthetic visit from schedule through signed note and charge handoff", async ({ page }) => {
  await page.goto(`/schedule?appointment=${APPOINTMENT_ID}`);

  await expect(page.getByRole("heading", { name: "Patient Review" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog").getByText("Jordan Ellis", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Start Note|Resume Note/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/encounters\/[0-9a-f-]+$/i);

  await expect(page.getByRole("heading", { name: "Active Progress Note" })).toBeVisible({ timeout: 15_000 });

  const signedHandoff = page.getByText("Signed clinical record → Charge Capture", { exact: false });
  if (await signedHandoff.isVisible().catch(() => false)) {
    await expect(signedHandoff).toBeVisible();
    return;
  }

  await page.getByLabel("Session / SOAP Note").fill(
    "Synthetic psychotherapy progress note. Client participated in supportive psychotherapy and collaborative problem solving. No acute safety concerns were reported. Continue current treatment plan and reassess at next visit.",
  );

  const serviceLineComplete = page.getByText(/\d+ service line\(s\) connected\./);
  if (!(await serviceLineComplete.isVisible().catch(() => false))) {
    await page.getByPlaceholder("Charge $").fill("150.00");
    await page.getByRole("button", { name: "+ Add Service Line" }).click();
    await expect(page.getByText("Service line added to encounter.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 service line\(s\) connected\./)).toBeVisible();
  }

  await page.getByPlaceholder("Provider signature").fill("Jamie Parker, LCSW");
  await page.getByRole("button", { name: "Sign & Lock Note" }).click();

  await expect(
    page.getByText(
      "Clinical note signed and locked. THERASSISTANT handed the encounter to Charge Capture",
      { exact: false },
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(signedHandoff).toBeVisible();
});
