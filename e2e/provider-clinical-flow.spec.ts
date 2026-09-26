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

  await page.locator("#encounter-progress-note-editor").fill(
    "Synthetic psychotherapy progress note. Client participated in supportive psychotherapy and collaborative problem solving. No acute safety concerns were reported. Continue current treatment plan and reassess at next visit.",
  );

  // The redundant readiness dashboard was removed; use the actual persisted service-line table.
  const recordedServices = page.locator("#encounter-coding-service .encounter-saved-services tbody tr");
  if ((await recordedServices.count()) === 0) {
    await page.getByRole("spinbutton", { name: "Service charge" }).fill("150.00");
    await page.getByRole("button", { name: "+ Add Service Line" }).click();
    // Confirm the service was actually saved instead of relying on obsolete toast text.
    await expect(recordedServices).toHaveCount(1, { timeout: 15_000 });
  }

  await page.getByPlaceholder("Provider signature").fill("Jamie Parker, LCSW");
  const signButton = page.getByRole("button", { name: "Sign & Lock Note" });
  await expect(signButton).toBeEnabled({ timeout: 15_000 });
  await signButton.click();

  // Signing is accepted only when the persisted, locked clinical handoff is displayed.
  // The previous transient success message was retired in favor of nonblocking billing follow-up.
  await expect(signedHandoff).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Open Charge Capture" })).toBeVisible();
});
