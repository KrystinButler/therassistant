import { expect, test } from "@playwright/test";

const APPOINTMENT_ID = "50000000-0000-4000-8000-000000000002";

test("provider completes the synthetic insured visit for billing", async ({ page }) => {
  await page.goto(`/schedule?appointment=${APPOINTMENT_ID}`);

  await expect(page.getByRole("heading", { name: "Patient Review" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog").getByText("Taylor Morgan", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Start Note|Resume Note/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/encounters\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: "Active Progress Note" })).toBeVisible({ timeout: 15_000 });

  const signedHandoff = page.getByText("Signed clinical record → Charge Capture", { exact: false });
  if (await signedHandoff.isVisible().catch(() => false)) return;

  await page.locator("#encounter-progress-note-editor").fill(
    "Synthetic insured psychotherapy progress note. Client participated in psychotherapy and collaborative problem solving. No acute safety concerns were reported. Continue the current plan of care.",
  );

  const diagnosisReady = page.getByText(/\d+ diagnosis record\(s\) connected\./);
  if (!(await diagnosisReady.isVisible().catch(() => false))) {
    await page.getByPlaceholder("Search ICD-10-CM code or diagnosis").fill("F41.1");
    await page.getByPlaceholder("Diagnosis description").fill("Generalized anxiety disorder");
    await page.getByRole("button", { name: "+ Add Diagnosis" }).click();
    await expect(page.getByText("Diagnosis added to encounter.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 diagnosis record\(s\) connected\./)).toBeVisible();
  }

  const serviceLineReady = page.getByText(/\d+ service line\(s\) connected\./);
  if (!(await serviceLineReady.isVisible().catch(() => false))) {
    await page.getByPlaceholder("Charge $").fill("150.00");
    await page.getByRole("button", { name: "+ Add Service Line" }).click();
    await expect(page.getByText("Unbilled service line added.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 service line\(s\) connected\./)).toBeVisible();
  }

  await page.getByPlaceholder("Provider signature").fill("Jamie Parker, LCSW");
  const signButton = page.getByRole("button", { name: "Sign & Lock Note" });
  await expect(signButton).toBeEnabled({ timeout: 15_000 });
  await signButton.click();

  await expect(
    page.getByText("Clinical note signed and locked. THERASSISTANT handed the encounter to Charge Capture", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(signedHandoff).toBeVisible();
});
