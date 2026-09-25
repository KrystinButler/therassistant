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

  // Signed documentation no longer includes a separate billing-readiness summary.
  const recordedDiagnoses = page.locator("#encounter-diagnoses tbody tr");
  if ((await recordedDiagnoses.count()) === 0) {
    await page.getByPlaceholder("Search ICD-10-CM code or diagnosis").fill("F41.1");
    await page.getByPlaceholder("Diagnosis description").fill("Generalized anxiety disorder");
    await page.getByRole("button", { name: "+ Add Diagnosis" }).click();
    await expect(page.getByText("Diagnosis added to encounter.")).toBeVisible({ timeout: 15_000 });
    await expect(recordedDiagnoses).toHaveCount(1);
  }

  const recordedServices = page.locator("#encounter-coding-service .encounter-saved-services tbody tr");
  if ((await recordedServices.count()) === 0) {
    await page.getByRole("spinbutton", { name: "Service charge" }).fill("150.00");
    await page.getByRole("button", { name: "+ Add Service Line" }).click();
    await expect(page.getByText("Unbilled service line added.")).toBeVisible({ timeout: 15_000 });
    await expect(recordedServices).toHaveCount(1);
  }

  await page.getByPlaceholder("Provider signature").fill("Jamie Parker, LCSW");
  const signButton = page.getByRole("button", { name: "Sign & Lock Note" });
  await expect(signButton).toBeEnabled({ timeout: 15_000 });
  await signButton.click();

  // Assert the durable locked-note handoff rather than the removed toast text.
  await expect(signedHandoff).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Open Charge Capture" })).toBeVisible();
});
