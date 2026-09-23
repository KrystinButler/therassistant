import { expect, test, type Dialog, type Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

async function answerDialogs(
  page: Page,
  answers: Array<string | boolean>,
  action: () => Promise<unknown>,
) {
  let index = 0;
  const handler = async (dialog: Dialog) => {
    const answer = answers[index++];
    if (dialog.type() === "prompt") {
      await dialog.accept(typeof answer === "string" ? answer : "");
    } else if (dialog.type() === "confirm") {
      if (answer === false) await dialog.dismiss();
      else await dialog.accept();
    } else {
      await dialog.accept();
    }
  };
  page.on("dialog", handler);
  try {
    await action();
    await expect.poll(() => index).toBe(answers.length);
  } finally {
    page.off("dialog", handler);
  }
}

test("staff creates, archives, records and accepts the synthetic insured claim", async ({ page }) => {
  const validationResponses: string[] = [];
  const archiveResponses: string[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    const isValidation = url.includes("/rest/v1/rpc/rcm_validate_claim");
    const isArchive =
      url.includes("/rest/v1/rpc/prepare_claim_edi_artifact") ||
      url.includes("/rest/v1/rpc/finalize_claim_edi_artifact") ||
      url.includes("/storage/v1/");
    if (!isValidation && !isArchive) return;
    let body = "";
    try { body = await response.text(); } catch { body = "<binary-or-unreadable>"; }
    const line = `${response.status()} ${url} ${body.slice(0, 1200)}`;
    if (isValidation) validationResponses.push(line);
    if (isArchive) archiveResponses.push(line);
  });

  await page.goto("/billing/charges");
  await expect(page.getByRole("heading", { name: "Charge Capture & Claim Submission" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /Claim Prep/ }).click();
  const chargeCard = page.locator("section.thera-card").filter({ hasText: "Taylor Morgan" }).first();
  const createButton = chargeCard.getByRole("button", { name: "Create & Scrub Claim" });
  if (await createButton.isVisible().catch(() => false)) {
    await expect(chargeCard).toContainText("Synthetic Commercial Payer");
    await createButton.click();

    const successMessage = page.getByText(/passed scrub and is ready to batch/);
    const rejectionMessage = page.getByText(/created and moved to Rejections for correction/);
    await expect.poll(async () => {
      if (await successMessage.isVisible().catch(() => false)) return "ready";
      if (await rejectionMessage.isVisible().catch(() => false)) {
        return `rejected: ${await rejectionMessage.innerText()} | validate=${validationResponses.join(" || ")}`;
      }
      const scrubFailure = page.getByText(/claim scrub could not complete/);
      if (await scrubFailure.isVisible().catch(() => false)) {
        return `scrub-error: ${await scrubFailure.innerText()} | validate=${validationResponses.join(" || ")}`;
      }
      const error = page.locator(".thera-state.error").first();
      if (await error.isVisible().catch(() => false)) return `error: ${await error.innerText()}`;
      return "pending";
    }, { timeout: 15_000 }).toBe("ready");
  }

  const payerCard = page.locator("section.thera-card").filter({ hasText: "Synthetic Commercial Payer" }).last();
  const batchButton = payerCard.getByRole("button", { name: /Batch by Payer \(1\)/ });
  await expect(batchButton).toBeEnabled({ timeout: 15_000 });
  await batchButton.click();
  await expect(page.getByText("Payer batch created with 1 claim(s).")).toBeVisible({ timeout: 15_000 });

  const archiveButton = page.getByRole("button", { name: "Archive & Download 837P" });
  await expect(archiveButton).toBeEnabled({ timeout: 15_000 });
  await archiveButton.click();
  const archiveSuccess = page.getByText(/837P archived and verified/);
  await expect.poll(async () => {
    if (await archiveSuccess.isVisible().catch(() => false)) return "archived";
    const error = page.locator(".thera-state.error").first();
    if (await error.isVisible().catch(() => false)) {
      return `archive-error: ${await error.innerText()} | responses=${archiveResponses.join(" || ")}`;
    }
    return "pending";
  }, { timeout: 15_000 }).toBe("archived");
  await expect(page.getByRole("button", { name: "Download Archived 837P" })).toBeVisible({ timeout: 15_000 });

  const submissionButton = page.getByRole("button", { name: "Record External Submission" });
  await expect(submissionButton).toBeEnabled({ timeout: 15_000 });
  await answerDialogs(page, ["E2E-837P-SUBMISSION-001", true], () => submissionButton.click());
  await expect(page.getByText("External 837P submission recorded for 1 claim(s).")).toBeVisible({ timeout: 15_000 });

  const acceptedButton = page.getByRole("button", { name: "Record Accepted" });
  await expect(acceptedButton).toBeEnabled({ timeout: 15_000 });
  await answerDialogs(
    page,
    ["277CA", "A1", "Accepted for processing", "E2E-ACK-001"],
    () => acceptedButton.click(),
  );
  await expect(page.getByText(/277CA accepted acknowledgement recorded\. Submission status: accepted\./)).toBeVisible({ timeout: 15_000 });
});
