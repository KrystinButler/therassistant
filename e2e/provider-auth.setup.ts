import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { providerStorageState } from "../playwright.config";
import { requireSyntheticIdentityMatrix } from "./identity-contract";

const SYNTHETIC_PROVIDER_APPOINTMENT_IDS = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
];

async function advanceSyntheticAppointmentsToProviderServiceTime() {
  const supabaseUrl = (
    process.env.E2E_SUPABASE_URL ??
    process.env.SUPABASE_URL
  )?.replace(/\/$/, "");
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Local Supabase URL and secret key are required to advance synthetic provider appointments.",
    );
  }

  // The isolated seed starts these visits in the future so the patient pre-visit
  // lifecycle can be exercised first. Provider E2E represents the later service
  // phase, so advance only the synthetic appointments to completed service times
  // before a clinical encounter is created. Never relax the production guard that
  // prevents future-dated clinical notes from being signed.
  const firstStart = Date.now() - 3 * 60 * 60 * 1000;

  for (const [index, appointmentId] of SYNTHETIC_PROVIDER_APPOINTMENT_IDS.entries()) {
    const startsAt = new Date(firstStart + index * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 53 * 60 * 1000);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/appointments?id=eq.${encodeURIComponent(appointmentId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Could not advance synthetic appointment ${appointmentId} (${response.status}): ${text}`,
      );
    }

    const rows = text ? JSON.parse(text) : [];
    const updated = Array.isArray(rows) ? rows[0] : null;
    const updatedStart = updated?.starts_at
      ? new Date(updated.starts_at).getTime()
      : Number.NaN;
    if (!Number.isFinite(updatedStart) || updatedStart > Date.now()) {
      throw new Error(
        `Synthetic appointment ${appointmentId} was not advanced to a non-future service time.`,
      );
    }
  }
}

setup("authenticate synthetic provider browser session", async ({ page }) => {
  const { provider } = requireSyntheticIdentityMatrix();
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(provider.email);
  await page.getByLabel("Password").fill(provider.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".schedule-provider-identity")).toContainText("Jamie Parker");

  await advanceSyntheticAppointmentsToProviderServiceTime();

  await mkdir(dirname(providerStorageState), { recursive: true });
  await page.context().storageState({ path: providerStorageState });
});
