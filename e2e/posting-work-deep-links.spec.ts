import { expect, test, type Page } from "@playwright/test";

const claimId = "10000000-0000-4000-8000-000000000001";
const fileOne = "20000000-0000-4000-8000-000000000001";
const fileTwo = "20000000-0000-4000-8000-000000000002";
const claimTaskId = "30000000-0000-4000-8000-000000000001";
const fileTaskId = "30000000-0000-4000-8000-000000000002";
const exactTaskId = "30000000-0000-4000-8000-000000000004";
const exactEraClaimId = "40000000-0000-4000-8000-000000000002";
const unrelatedTaskId = "30000000-0000-4000-8000-000000000003";

const tasks = [
  { id: exactTaskId, title: "Review exact remittance exception", description: "Review only this retained remittance.",
    source_object_type: "era_claim", source_object_id: exactEraClaimId, workqueue_type: "payment_posting_issue" },
  { id: claimTaskId, title: "Review claim posting exception", description: "Review both remittances for the claim.",
    source_object_type: "claim", source_object_id: claimId, workqueue_type: "payment_posting_issue" },
  { id: fileTaskId, title: "Review specific ERA exception", description: "Review the second file only.",
    source_object_type: "era", source_object_id: fileTwo, workqueue_type: "unmatched_era" },
  { id: unrelatedTaskId, title: "Contract variance task", description: "Unrelated task.",
    source_object_type: "claim", source_object_id: claimId, workqueue_type: "contract_variance" },
].map((row) => ({ ...row, workqueue_status: "in_progress", priority: "normal", due_date: null }));

// Override read fixtures only; real staff authentication and tenant initialization remain in use.
async function postingFixtures(page: Page) {
  const taskLookups: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/rest/v1/") && request.method() !== "GET") {
      writes.push(request.method() + " " + new URL(request.url()).pathname);
    }
  });
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    if (route.request().method() !== "GET") return route.continue();
    let rows: unknown[] | undefined;
    if (table === "workqueue_items") {
      const id = url.searchParams.get("id");
      if (id) taskLookups.push(id);
      rows = id ? tasks.filter((row) => "eq." + row.id === id) : tasks;
    } else if (table === "era_files") {
      rows = [
        { id: fileOne, file_name: "first-remittance.835", check_or_trace_number: "TRACE-1", status: "imported" },
        { id: fileTwo, file_name: "second-remittance.835", check_or_trace_number: "TRACE-2", status: "imported" },
      ];
    } else if (table === "era_claims") {
      rows = [
        { id: "40000000-0000-4000-8000-000000000001", claim_id: claimId, era_file_id: fileOne,
          patient_control_number: "SYNTHETIC-CLAIM", charge_amount_cents: 10000, paid_amount_cents: 6000, status: "exception" },
        { id: "40000000-0000-4000-8000-000000000002", claim_id: claimId, era_file_id: fileTwo,
          patient_control_number: "SYNTHETIC-CLAIM", charge_amount_cents: 10000, paid_amount_cents: 4000, status: "exception" },
      ];
    }
    if (rows === undefined) return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  return { taskLookups, writes };
}

for (const [id, title, files] of [
  [exactTaskId, "Review exact remittance exception", ["second-remittance.835"]],
  [claimTaskId, "Review claim posting exception", ["first-remittance.835", "second-remittance.835"]],
  [fileTaskId, "Review specific ERA exception", ["second-remittance.835"]],
] as const) {
  test("Work Center opens and focuses exact posting task: " + title, async ({ page }) => {
    const requests = await postingFixtures(page);
    await page.goto("/work-center");
    const workRow = page.getByRole("row").filter({ has: page.getByText(title, { exact: true }) });
    await workRow.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/payments\\?tab=era&work=" + id + "$"));
    const panel = page.locator("#posting-work-" + id);
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator('[id^="posting-work-"]')).toHaveCount(1);
    await expect(panel.getByRole("row")).toHaveCount(files.length + 1);
    for (const file of files) await expect(panel.getByRole("cell", { name: file, exact: true })).toBeVisible();
    if (files.length > 1) await expect(panel.getByText(/Multiple remittances/)).toBeVisible();
    else await expect(panel.getByRole("cell", { name: "first-remittance.835", exact: true })).toHaveCount(0);
    expect(requests.taskLookups).toContain("eq." + id);
    expect(requests.writes).toEqual([]);
  });
}

for (const id of ["malformed", "30000000-0000-4000-8000-000000000099", unrelatedTaskId]) {
  test("unavailable posting task preserves Payments workspace: " + id, async ({ page }) => {
    const requests = await postingFixtures(page);
    await page.goto("/payments?tab=era&work=" + id);
    await expect(page.getByRole("heading", { name: "Import ERA / 835", exact: true })).toBeVisible();
    await expect(page.getByText("The requested posting task is unavailable in this organization or is not an ERA posting issue.", { exact: true })).toBeVisible();
    await expect(page.locator('[id^="posting-work-"]')).toHaveCount(0);
    if (id === "malformed") expect(requests.taskLookups).toEqual([]);
    else expect(requests.taskLookups).toContain("eq." + id);
    expect(requests.writes).toEqual([]);
  });
}
