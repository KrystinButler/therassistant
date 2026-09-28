import { expect, test } from "@playwright/test";

const SOURCE = "Synthetic E2E Directory";
const ROLE_ID = "synthetic-practitioner-role-001";
const NPI = "1234567893";
const TAXONOMY = "1041C0700X";

function practitionerRole(email: string, phone: string) {
  return {
    resourceType: "PractitionerRole",
    id: ROLE_ID,
    identifier: [
      { system: "http://hl7.org/fhir/sid/us-npi", value: NPI },
    ],
    specialty: [
      {
        coding: [
          {
            system: "http://nucc.org/provider-taxonomy",
            code: TAXONOMY,
          },
        ],
      },
    ],
    telecom: [
      { system: "email", use: "work", value: email },
      { system: "phone", use: "work", value: phone },
    ],
    healthcareService: null,
    qualification: null,
  };
}

async function chooseRoleFile(
  page: import("@playwright/test").Page,
  email: string,
  phone: string,
) {
  await page.getByLabel("PractitionerRole JSON").setInputFiles({
    name: "synthetic-practitioner-role.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(practitionerRole(email, phone))),
  });
}

test("staff can validate, save, and idempotently reimport a provider role", async ({
  page,
}) => {
  await page.goto("/administration/imports");
  await expect(
    page.getByRole("heading", { name: "Imports & Migration" }),
  ).toBeVisible();

  await page.getByLabel("Directory source").fill(SOURCE);

  const firstEmail = "role.one@example.test";
  const firstPhone = "3035550111";
  await chooseRoleFile(page, firstEmail, firstPhone);
  await page.getByRole("button", { name: "Validate file" }).click();

  await expect(page.getByText(`NPI ${NPI}`)).toBeVisible();
  await expect(page.getByText(`Specialties: ${TAXONOMY}`)).toBeVisible();
  await expect(page.getByText(`Work emails: ${firstEmail}`)).toBeVisible();
  await expect(page.getByText(`Clinic phones: ${firstPhone}`)).toBeVisible();

  await page.getByRole("button", { name: "Save provider role" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Provider role saved." }),
  ).toBeVisible();

  let row = page
    .locator("table.thera-table tbody tr")
    .filter({ hasText: `${SOURCE} / ${ROLE_ID}` });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(firstEmail);
  await expect(row).toContainText(firstPhone);

  const updatedEmail = "role.updated@example.test";
  const updatedPhone = "3035550222";
  await chooseRoleFile(page, updatedEmail, updatedPhone);
  await page.getByRole("button", { name: "Validate file" }).click();
  await expect(page.getByText(`Work emails: ${updatedEmail}`)).toBeVisible();
  await expect(page.getByText(`Clinic phones: ${updatedPhone}`)).toBeVisible();

  await page.getByRole("button", { name: "Save provider role" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Provider role saved." }),
  ).toBeVisible();

  row = page
    .locator("table.thera-table tbody tr")
    .filter({ hasText: `${SOURCE} / ${ROLE_ID}` });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(updatedEmail);
  await expect(row).toContainText(updatedPhone);
  await expect(row).not.toContainText(firstEmail);
  await expect(row).not.toContainText(firstPhone);
});
