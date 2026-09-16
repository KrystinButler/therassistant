# Therassistant RCM Workqueue Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicate revenue-cycle workflows with five canonical operational areas: Charges, Rejections, Claims, Denials, and Payments.

**Architecture:** Records such as patients, providers, payers, encounters, and Claim 360 remain reference/detail pages. Operational work has one owner: Charges from signed note through batching/submission; Rejections for failed scrub or clearinghouse correction; Claims for accepted/submitted open balances; Denials for CARC-driven denied claims, corrected claims, appeals, and deferred denial work; Payments for posting, ERA/835, unapplied funds, adjustments/reversals, underpayments, and recoupments/refunds.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Wouter, Supabase demo client, Playwright, pnpm 10.28.0.

**Spec:** `docs/superpowers/specs/2026-09-16-workqueue-rcm-consolidation-design.md`

## Global Constraints

- Revenue Cycle navigation is exactly: Charges, Rejections, Claims, Denials, Payments.
- No Work Center UI remains.
- No standalone Authorization workqueue is created.
- No separate Claim Validation, Claim Follow-Up, Claim Submission, Insurance A/R, or Appeals workflow remains.
- `ready_for_validation` belongs to Charges; `validation_failed` belongs to Rejections.
- Clearinghouse rejection belongs to Rejections.
- Claims has one payer queue with exactly these mutually exclusive tabs: No Response, Deferred, 0-30 Days, 31-60 Days, 61-90 Days, 91-120 Days, 120+ Days.
- Denials has one payer queue with CARC/category tabs plus Corrected Claims, Appeals, Deferred; each denial appears in one tab only.
- Charges owns payer batching, electronic submission, 837P download, and CMS-1500 printing.
- Payments retains posting, ERA/835, unapplied funds, adjustments/reversals, underpayments, recoupments/refunds, and does not duplicate Denials.
- Reuse existing Supabase tables/status history. Do not introduce a second queue-state table.
- A record can be visible in detail/history views, but only one operational area owns active work.
- Use pnpm only.

---

## File Structure

### Create

- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts`
- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts`
- `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts`
- `artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts`
- `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx`
- `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx`
- `artifacts/therassistant-inventory/src/navigation/sections.ts`
- `e2e/rcm-workqueues.spec.ts`

### Modify

- `artifacts/therassistant-inventory/src/App.tsx`
- `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- `artifacts/therassistant-inventory/src/domains/billing/repository.ts`
- `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- `artifacts/therassistant-inventory/src/domains/claims/workflow.ts`
- `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.types.ts`
- `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts` then rename it to `claims-ledger-repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/ar-work-drawers.tsx`
- `artifacts/therassistant-inventory/src/domains/payments/PaymentsPage.tsx`
- `artifacts/therassistant-inventory/src/domains/payments/repository.ts`
- `artifacts/therassistant-inventory/src/pages/restored-modules.tsx`
- `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- `e2e/workspaces.spec.ts`

### Delete after replacement imports are complete

- `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- `artifacts/therassistant-inventory/src/navigation/workspaces.ts`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`
- `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts`

---

### Task 1: Define canonical queue ownership

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts`
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts`

**Interfaces:**
- Produces `getOperationalHome(input): OperationalHome`
- Produces `getClaimsTab(input, today): ClaimsTab`
- Produces `getRejectionCategories(messages): RejectionCategory[]`
- Produces `getDenialTab(input): DenialTab`

- [ ] **Step 1: Write the failing contract test**

```ts
import assert from "node:assert/strict";
import {
  getClaimsTab,
  getDenialTab,
  getOperationalHome,
  getRejectionCategories,
} from "./queue-routing.ts";

const today = new Date("2026-09-16T12:00:00Z");

assert.equal(getOperationalHome({ claimStatus: "ready_for_validation", hasActiveDenial: false, openBalanceCents: 10000 }), "charges");
assert.equal(getOperationalHome({ claimStatus: "validation_failed", hasActiveDenial: false, openBalanceCents: 10000 }), "rejections");
assert.equal(getOperationalHome({ claimStatus: "rejected", hasActiveDenial: false, openBalanceCents: 10000 }), "rejections");
assert.equal(getOperationalHome({ claimStatus: "ready_for_batch", hasActiveDenial: false, openBalanceCents: 10000 }), "charges");
assert.equal(getOperationalHome({ claimStatus: "submitted", hasActiveDenial: false, openBalanceCents: 10000 }), "claims");
assert.equal(getOperationalHome({ claimStatus: "denied", hasActiveDenial: true, openBalanceCents: 10000 }), "denials");
assert.equal(getOperationalHome({ claimStatus: "paid", hasActiveDenial: false, openBalanceCents: 0 }), "payments");

assert.equal(getClaimsTab({ deferred: true, submittedAt: "2026-06-01", serviceDate: "2026-05-30", hasPayerResponse: false }, today), "deferred");
assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-09-10", serviceDate: "2026-09-01", hasPayerResponse: false }, today), "no_response");
assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-09-01", serviceDate: "2026-08-20", hasPayerResponse: true }, today), "0_30");
assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-07-15", serviceDate: "2026-07-15", hasPayerResponse: true }, today), "61_90");
assert.equal(getClaimsTab({ deferred: false, submittedAt: "2026-04-01", serviceDate: "2026-04-01", hasPayerResponse: true }, today), "120_plus");

assert.deepEqual(
  getRejectionCategories(["Patient is missing.", "Claim line CPT/HCPCS is missing.", "Authorization number is invalid."]),
  ["patient", "procedure_modifier", "authorization"],
);

assert.equal(getDenialTab({ deferred: true, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "deferred");
assert.equal(getDenialTab({ deferred: false, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "appeals");
assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: true, denialCategory: "coding" }), "corrected_claims");
assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: false, denialCategory: "timely_filing" }), "timely_filing");
```

- [ ] **Step 2: Verify it fails**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
```

Expected: module-not-found for `queue-routing.ts`.

- [ ] **Step 3: Implement the routing model**

```ts
import { getClaimErrorGuidance } from "../claims/claim-error-guidance";

export type OperationalHome = "charges" | "rejections" | "claims" | "denials" | "payments" | null;
export type ClaimsTab = "no_response" | "deferred" | "0_30" | "31_60" | "61_90" | "91_120" | "120_plus";
export type RejectionCategory = "patient" | "subscriber" | "provider" | "payer" | "diagnosis" | "procedure_modifier" | "authorization" | "claim_format" | "other";
export type DenialTab = "corrected_claims" | "appeals" | "deferred" | string;

export function getOperationalHome(input: { claimStatus: unknown; hasActiveDenial: boolean; openBalanceCents: number }): OperationalHome {
  const status = String(input.claimStatus ?? "");
  if (input.hasActiveDenial || ["denied", "appealed"].includes(status)) return "denials";
  if (["validation_failed", "rejected", "corrected"].includes(status)) return "rejections";
  if (["ready_for_validation", "ready_for_batch", "batched"].includes(status)) return "charges";
  if (["paid", "partially_paid"].includes(status) && input.openBalanceCents <= 0) return "payments";
  if (["submitted", "accepted", "partially_paid"].includes(status) && input.openBalanceCents > 0) return "claims";
  return null;
}
```

Implement `getClaimsTab` with exact precedence `Deferred -> No Response -> aging`. Aging uses `submittedAt` first and `serviceDate` only as fallback. Use inclusive day ranges 0-30, 31-60, 61-90, 91-120, >120.

Implement `getRejectionCategories` by using `getClaimErrorGuidance(message)?.target`, then keyword fallback: `subscriber/member`, `authorization/prior auth`, `payer`, `provider/npi/taxonomy`, `diagnosis`, `cpt/hcpcs/modifier/procedure`, `patient`, then claim-format keywords `date/frequency/place of service/charge/control number`; otherwise `other`. Return unique values in first-seen order.

Implement `getDenialTab` with exact precedence `Deferred -> Appeals -> Corrected Claims -> normalized denialCategory -> other`.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
pnpm typecheck
git add artifacts/therassistant-inventory/src/domains/rcm
git commit -m "feat: define canonical RCM queue routing"
```

---

### Task 2: Replace workspace navigation and legacy routes

**Files:**
- Create: `artifacts/therassistant-inventory/src/navigation/sections.ts`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Create: `e2e/rcm-workqueues.spec.ts`
- Modify: `e2e/workspaces.spec.ts`
- Delete: `artifacts/therassistant-inventory/src/navigation/workspaces.ts`

**Interfaces:**
- Produces `NAV_SECTIONS`, `getVisibleSections`, `getNavigationContext`, `toggleExpandedSection`.

- [ ] **Step 1: Write failing navigation/redirect tests**

```ts
import { expect, test } from "@playwright/test";

const redirects = [
  ["/charges", "/billing/charges"],
  ["/claims/submission", "/billing/charges"],
  ["/claims/follow-up", "/claims"],
  ["/ar-denials", "/denials"],
  ["/work-center", "/claims"],
] as const;

for (const [legacy, target] of redirects) {
  test(`${legacy} redirects to ${target}`, async ({ page }) => {
    await page.goto(legacy);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
  });
}

test("Revenue Cycle navigation has the five canonical links", async ({ page }) => {
  await page.goto("/claims");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  for (const label of ["Charges", "Rejections", "Claims", "Denials", "Payments"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  for (const removed of ["Work Center", "Claim Follow-Up", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(nav.getByText(removed, { exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
```

- [ ] **Step 3: Create `sections.ts`**

The Revenue Cycle section is exactly:

```ts
{
  id: "revenue-cycle",
  label: "Revenue Cycle",
  primaryHref: "/billing/charges",
  children: [
    { id: "charges", label: "Charges", href: "/billing/charges" },
    { id: "rejections", label: "Rejections", href: "/rejections" },
    { id: "claims", label: "Claims", href: "/claims" },
    { id: "denials", label: "Denials", href: "/denials" },
    { id: "payments", label: "Payments", href: "/payments" },
  ],
}
```

Keep other application areas as navigation sections/items without calling them workspaces.

- [ ] **Step 4: Update AppShell**

Use section/item terminology and:

```tsx
<nav className="thera-nav" aria-label="Primary navigation">
```

Fallback topbar text becomes `Operations`.

- [ ] **Step 5: Add redirect-only legacy routes**

```tsx
function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <div className="thera-state">Redirecting...</div>;
}
```

Add `/rejections` temporarily rendering the current Claims component and `/denials` temporarily rendering the current A/R component. The final components replace these in Tasks 4 and 6. Legacy URLs render only `Redirect`.

- [ ] **Step 6: Rename generic route smoke-test language**

Change the array name `workspaces` to `routes` and test title `workspace renders` to `route renders` in `e2e/workspaces.spec.ts`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git add artifacts/therassistant-inventory/src/navigation/sections.ts artifacts/therassistant-inventory/src/components/app-shell.tsx artifacts/therassistant-inventory/src/App.tsx e2e
git rm artifacts/therassistant-inventory/src/navigation/workspaces.ts
git commit -m "refactor: replace workspace navigation with RCM sections"
```

---

### Task 3: Consolidate charge creation and claim submission into Charges

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Reuses `createClaimFromCharges`, `validateClaim`, `createBatch`, `submitBatch`.
- Produces `getBatchExportData`, `build837PText`, `buildCms1500Html`.

- [ ] **Step 1: Write failing output tests**

```ts
import assert from "node:assert/strict";
import { build837PText, buildCms1500Html } from "./claim-output.ts";

const sample = {
  batch: { id: "batch-123", batch_name: "Aetna 2026-09-16" },
  claims: [{
    claim: { id: "claim-1", patient_control_number: "TH-1001", total_charge_cents: 15000, service_date_from: "2026-09-01", payerName: "Aetna", clientName: "Demo Patient", providerName: "Demo Provider" },
    lines: [{ cpt_code: "90837", charge_amount_cents: 15000, units: 1, diagnosis_pointer: "1" }],
    diagnoses: [{ diagnosis_code: "F41.1", pointer_order: 1 }],
  }],
};

assert.match(build837PText(sample), /CLM\*TH-1001\*150\.00/);
assert.match(build837PText(sample), /SV1\*HC:90837\*150\.00/);
assert.match(buildCms1500Html(sample.claims[0]), /CMS-1500/);
assert.match(buildCms1500Html(sample.claims[0]), /Demo Patient/);
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts
```

- [ ] **Step 3: Make Charges the canonical UI**

Set heading to `Charges`. Use exactly:

```ts
type ChargesTab = "ready" | "blocked" | "unbatched" | "batches" | "submitted";
```

`ready` = signed encounters ready for charge creation. `blocked` = signed encounters blocked from charge creation. `unbatched` = claims in `ready_for_validation` or `ready_for_batch`. `batches` = payer batches ready for submission/export/print. `submitted` = submitted batch history.

After `createClaimFromCharges`, immediately call `validateClaim`. Failed validation becomes `validation_failed` and leaves Charges for Rejections; successful validation becomes `ready_for_batch` and remains in Charges.

Before `createBatch`, enforce one payer:

```ts
const payerIds = new Set(selectedClaims.map((claim) => String(claim.payer_id ?? "")));
if (payerIds.size !== 1) throw new Error("A claim batch must contain one payer only.");
```

Render `Download 837P` and `Print CMS-1500` buttons in the Charges toolbar at all times; disable until a batch/claim selection exists.

- [ ] **Step 4: Add export data**

```ts
export async function getBatchExportData(batchId: string) {
  const batch = await repository.getBatch(batchId);
  if (!batch) throw new Error("Claim batch not found.");
  const claims = await repository.getBatchClaims(batchId);
  const enriched = await getClaimSubmissionData();
  const byId = new Map(enriched.claims.map((claim) => [claim.id, claim]));
  return {
    batch,
    claims: await Promise.all(claims.map(async (claim) => ({
      claim: byId.get(claim.id) ?? claim,
      lines: await repository.getClaimLines(claim.id),
      diagnoses: await repository.getClaimDiagnoses(claim.id),
    }))),
  };
}
```

- [ ] **Step 5: Implement the 837P demo builder with no undefined helpers**

```ts
export type BatchExportData = Awaited<ReturnType<typeof getBatchExportData>>;

function clean(value: unknown) {
  return String(value ?? "").replace(/[~*:^]/g, " ").trim();
}

export function build837PText(input: BatchExportData) {
  const control = clean(input.batch.id).replace(/\D/g, "").slice(-9).padStart(9, "0") || "000000001";
  const segments: string[] = [
    `ISA*00*          *00*          *ZZ*THERASSISTANT   *ZZ*DEMO_PAYER      *260916*1200*^*00501*${control}*0*T*:~`,
    `GS*HC*THERASSISTANT*DEMO_PAYER*20260916*1200*1*X*005010X222A1~`,
    `ST*837*0001*005010X222A1~`,
    `BHT*0019*00*${control}*20260916*1200*CH~`,
  ];

  for (const [claimIndex, item] of input.claims.entries()) {
    const controlNumber = clean(item.claim.patient_control_number ?? item.claim.id);
    const total = (Number(item.claim.total_charge_cents ?? 0) / 100).toFixed(2);
    segments.push(`HL*${claimIndex + 1}**20*1~`);
    segments.push(`NM1*85*2*${clean(item.claim.providerName ?? "THERASSISTANT")}*****XX*DEMO~`);
    segments.push(`NM1*IL*1*${clean(item.claim.clientName ?? "PATIENT")}****MI*DEMO~`);
    segments.push(`CLM*${controlNumber}*${total}***11:B:1*Y*A*Y*Y~`);
    for (const [lineIndex, line] of item.lines.entries()) {
      const amount = (Number(line.charge_amount_cents ?? 0) / 100).toFixed(2);
      segments.push(`LX*${lineIndex + 1}~`);
      segments.push(`SV1*HC:${clean(line.cpt_code)}*${amount}*UN*${Number(line.units ?? 1)}***${clean(line.diagnosis_pointer ?? "1")}~`);
    }
  }

  segments.push(`SE*${segments.length - 1}*0001~`);
  segments.push(`GE*1*1~`);
  segments.push(`IEA*1*${control}~`);
  return segments.join("\n");
}
```

Label the output `837P Demo Export`; do not claim production EDI certification without real trading-partner configuration. Download as `therassistant-837p-<batch-id>.txt`.

- [ ] **Step 6: Implement CMS-1500 printable HTML**

```ts
export function buildCms1500Html(item: BatchExportData["claims"][number]) {
  const lines = item.lines.map((line) => `<tr><td>${clean(line.service_date ?? item.claim.service_date_from)}</td><td>${clean(line.cpt_code)}</td><td>${clean(line.diagnosis_pointer ?? "1")}</td><td>${(Number(line.charge_amount_cents ?? 0) / 100).toFixed(2)}</td></tr>`).join("");
  return `<!doctype html><html><head><title>CMS-1500</title><style>@page{size:8.5in 11in;margin:.25in}.cms1500{width:8in;min-height:10.5in;font:10px Arial,sans-serif}table{width:100%;border-collapse:collapse}td,th{border:1px solid #555;padding:4px}</style></head><body><div class="cms1500"><h1>CMS-1500</h1><p>Patient: ${clean(item.claim.clientName)}</p><p>Payer: ${clean(item.claim.payerName)}</p><p>Provider: ${clean(item.claim.providerName)}</p><table><thead><tr><th>DOS</th><th>CPT/HCPCS</th><th>Dx Ptr</th><th>Charge</th></tr></thead><tbody>${lines}</tbody></table></div></body></html>`;
}
```

Open the generated HTML in a print window, call `print()`, close on `afterprint`.

- [ ] **Step 7: Add deterministic Charges UI test**

```ts
test("Charges owns claim submission outputs", async ({ page }) => {
  await page.goto("/billing/charges");
  await expect(page.getByRole("heading", { level: 1, name: "Charges" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download 837P/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Print CMS-1500/i })).toBeVisible();
  await expect(page.getByText("Claim Submission", { exact: true })).toHaveCount(0);
});
```

- [ ] **Step 8: Verify and commit**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts
pnpm typecheck
pnpm build
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Charges owns"
git add artifacts/therassistant-inventory/src/domains/billing artifacts/therassistant-inventory/src/domains/claims/repository.ts e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate submission into Charges"
```

---

### Task 4: Merge validation failures and clearinghouse rejections into Rejections

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workflow.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Consumes `getRejectionCategories`, `getClaimErrorGuidance`, `validateClaim`, `retryRejectedClaims`.

- [ ] **Step 1: Write failing Rejections test**

```ts
test("Rejections is payer and correction-field driven", async ({ page }) => {
  await page.goto("/rejections");
  await expect(page.getByRole("heading", { level: 1, name: "Rejections" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Rejection categories" })).toBeVisible();
  await expect(page.getByText("Validation", { exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Rejections is payer"
```

- [ ] **Step 3: Stop using Work Center to determine rejection membership**

Keep claim status/history in `validateClaimWorkflow`; remove user-facing “routed to Work Center” messages. Failed scrub = `validation_failed`. Successful scrub = `ready_for_batch`. Clearinghouse reject = `rejected` plus stored submission response.

- [ ] **Step 4: Implement RejectionsPage**

A claim qualifies when `claim_status` is `validation_failed`, `rejected`, or `corrected`, or latest submission response is `rejected`. Group by payer first. For the selected payer, create tabs from unresolved error messages through `getRejectionCategories`. A claim can appear in several Rejection tabs only when separate unresolved fields/categories exist.

Use `ClaimWorkDrawer` for correction. `Save & Revalidate` success changes to `ready_for_batch`, removing it from Rejections and returning it to Charges.

- [ ] **Step 5: Remove Denials/Appeals workflow actions from the generic claim drawer**

Keep denial/appeal information in Claim 360 history only. Denials owns denial/appeal actions.

- [ ] **Step 6: Wire, verify, commit**

```tsx
<Route path="/rejections"><RejectionsPage /></Route>
```

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Rejections"
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate rejection correction"
```

---

### Task 5: Build payer-specific Claims workqueues

**Files:**
- Rename: `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts` -> `artifacts/therassistant-inventory/src/domains/claims/claims-ledger-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Rename `getClaimsWorkspaceData()` to `getClaimsQueueData()`.
- Consumes `getOperationalHome`, `getClaimsTab`.

- [ ] **Step 1: Write failing Claims structure test**

```ts
test("Claims has payer queues and the approved tabs", async ({ page }) => {
  await page.goto("/claims");
  await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
  for (const tab of ["No Response", "Deferred", "0-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "120+ Days"]) {
    await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
  }
  for (const removed of ["Validation", "Submission", "Rejections", "Denials", "Appeals", "Workqueues"]) {
    await expect(page.getByRole("tab", { name: removed, exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Claims has payer"
```

- [ ] **Step 3: Add queue fields to repository rows**

```ts
type ClaimsQueueRow = ClaimsWorkspaceRow & {
  submittedAt: string | null;
  hasPayerResponse: boolean;
  deferred: boolean;
  hasActiveDenial: boolean;
};
```

`hasPayerResponse` is true when payer claim number or submission response exists. `deferred` uses current pending/snoozed/deferred state already stored in claim-specific work/history. Do not create a second state column solely for the UI.

- [ ] **Step 4: Implement payer workqueues**

```ts
const CLAIM_TABS = [
  ["no_response", "No Response"],
  ["deferred", "Deferred"],
  ["0_30", "0-30 Days"],
  ["31_60", "31-60 Days"],
  ["61_90", "61-90 Days"],
  ["91_120", "91-120 Days"],
  ["120_plus", "120+ Days"],
] as const;
```

Filter to `getOperationalHome(...) === "claims"`, group by payer, then classify each claim into one tab using `getClaimsTab`.

Claims has no Validate, Retry Rejected, Create Follow-Up, Denial, Appeal, or Submission actions.

- [ ] **Step 5: Wire, remove old page, verify, commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Claims"
git mv artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts artifacts/therassistant-inventory/src/domains/claims/claims-ledger-repository.ts
git rm artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate payer follow-up into Claims"
```

---

### Task 6: Build payer/CARC Denials workqueues

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/denials.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Move `isActiveAppealStatus(status)` from `claims/workqueues.ts` into `ar/denials.ts`.
- Produces `getDenialsQueueData()`.
- Consumes `getDenialTab`.

- [ ] **Step 1: Write failing Denials structure test**

```ts
test("Denials is payer-specific and CARC driven", async ({ page }) => {
  await page.goto("/denials");
  await expect(page.getByRole("heading", { level: 1, name: "Denials" })).toBeVisible();
  await expect(page.getByText(/CARC/i).first()).toBeVisible();
  for (const tab of ["Corrected Claims", "Appeals", "Deferred"]) {
    await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
  }
  for (const removed of ["Insurance A/R", "Patient A/R", "Underpayments", "Recoupments / Refunds"]) {
    await expect(page.getByRole("tab", { name: removed, exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Denials is payer-specific"
```

- [ ] **Step 3: Implement `getDenialsQueueData()`**

Return only denial-domain data: denials, appeals, payers, providers, and linked claim fields needed to identify corrected claims. Do not return insurance A/R, patient A/R, variance, or recovery data to Denials.

- [ ] **Step 4: Implement DenialsPage**

Group by payer. Assign one tab per denial:

```ts
getDenialTab({
  deferred: denial.workStatus === "pending" || denial.workStatus === "snoozed",
  appealActive: activeAppealByDenial.has(denial.id),
  correctedClaim: denial.denial_status === "corrected_claim" || linkedClaim.claim_frequency_code === "7",
  denialCategory: denial.denial_category ?? "other",
});
```

Render dynamic normalized denial-category tabs, then Corrected Claims, Appeals, Deferred. Show CARC, RARC, reason, amount, deadline, status. Reuse existing denial/appeal drawers and actions.

- [ ] **Step 5: Remove A/R/Work Center language**

Change denial history strings to `Denial work started from Denials.` and `Denial work resumed from Denials.` Internal `workqueue_items` may continue to store local status/history.

- [ ] **Step 6: Wire, delete old page, verify, commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Denials"
git rm artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx
git add artifacts/therassistant-inventory/src/domains/ar artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate CARC-driven Denials"
```

---

### Task 7: Make Payments own payment exceptions and remove duplicate Denials

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/payments/PaymentsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/payments/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/ar-work-drawers.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Payments tabs: Insurance Payments, Patient Payments, ERA / 835, Unapplied, Adjustments / Reversals, Underpayments, Recoupments / Refunds.

- [ ] **Step 1: Write failing Payments test**

```ts
test("Payments owns payment exceptions but not denials", async ({ page }) => {
  await page.goto("/payments");
  await expect(page.getByRole("tab", { name: /Underpayments/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Recoupments \/ Refunds/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Denials/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Payments owns"
```

- [ ] **Step 3: Move variance/recovery data ownership to Payments**

Move the existing underpayment variance and recovery/recoupment queries from `ar/repository.ts` into `payments/repository.ts` so `getPaymentsWorkspaceData()` returns `variances` and `recovery`. Remove those query paths from A/R repository after Denials uses `getDenialsQueueData()`.

- [ ] **Step 4: Replace Payments Denials tab**

```ts
type Tab = "insurance" | "patient" | "era" | "unapplied" | "adjustments" | "underpayments" | "recovery";
```

Use existing `UnderpaymentReviewDrawer` and `RecoveryReviewDrawer`. Change user-facing `Route to Work Center` actions to `Start Work`; keep internal `workqueue_items` only as local task/history storage.

When demo ERA creates a denial, message becomes `Denial recorded and moved to Denials.` Do not render a Denials table in Payments.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Payments"
git add artifacts/therassistant-inventory/src/domains/payments artifacts/therassistant-inventory/src/domains/ar e2e/rcm-workqueues.spec.ts
git commit -m "refactor: consolidate payment exceptions into Payments"
```

---

### Task 8: Delete duplicate workflow pages and stale links

**Files:**
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/restored-modules.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- Delete: `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

- [ ] **Step 1: Write failing stale-workflow regression test**

```ts
test("retired workflow names are not visible", async ({ page }) => {
  await page.goto("/");
  for (const label of ["Work Center", "Claim Follow-Up", "Insurance A/R", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Delete old implementations**

Remove `ClaimFollowUpPage` from `restored-modules.tsx`. Delete Work Center, standalone Claim Submission, and old claims workqueue builder after imports are migrated.

- [ ] **Step 3: Normalize dashboard/Billing links**

Only these operational targets remain:

```text
/billing/charges
/rejections
/claims
/denials
/payments
```

- [ ] **Step 4: Search for stale imports/copy**

```bash
rg -n "Work Center|WorkCenterPage|Claim Follow-Up|ClaimFollowUpPage|ClaimSubmissionPage|ClaimsWorkspacePage|ArWorkspacePage|Insurance A/R|A/R & Denials" artifacts/therassistant-inventory/src e2e
```

Expected: only intentional strings inside legacy redirect tests remain.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm build
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
git add artifacts/therassistant-inventory/src e2e/rcm-workqueues.spec.ts
git rm artifacts/therassistant-inventory/src/pages/work-center.tsx artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx artifacts/therassistant-inventory/src/domains/claims/workqueues.ts
git commit -m "refactor: remove duplicate revenue cycle workflows"
```

---

### Task 9: Full verification and duplicate-workflow guardrails

**Files:**
- Modify: `e2e/rcm-workqueues.spec.ts`
- Modify: `e2e/workspaces.spec.ts`

- [ ] **Step 1: Add transition assertions**

Verify these exact outcomes using the existing synthetic demo controls/data:

```text
Signed note -> Charges
Successful scrub -> Charges / ready for batch
Failed scrub -> Rejections and absent from Charges
Clearinghouse rejection -> Rejections and absent from Claims
Accepted/submitted open balance -> Claims and absent from Charges/Rejections
Active CARC denial -> Denials and absent from Claims
Appeal -> Denials / Appeals only
Deferred claim -> Claims / Deferred only
Deferred denial -> Denials / Deferred only
Paid zero-balance claim -> absent from Claims and Denials; payment remains visible in Payments/history
```

- [ ] **Step 2: Guard Claims tab uniqueness**

For one payer/control number, visit all seven Claims tabs and assert total matching rows across tabs is `<= 1`.

- [ ] **Step 3: Guard Denials tab uniqueness**

For one denial/control number, visit all dynamic denial reason tabs plus Corrected Claims, Appeals, Deferred and assert total matching rows is `<= 1`.

- [ ] **Step 4: Run all verification**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 5: Review remaining terminology**

```bash
rg -n "workspace|work center|claim follow-up|insurance a/r" artifacts/therassistant-inventory/src/domains artifacts/therassistant-inventory/src/components artifacts/therassistant-inventory/src/navigation
```

Remove every user-facing match. Internal CSS class names may remain only when not displayed to users.

- [ ] **Step 6: Commit final guards**

```bash
git add e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git commit -m "test: guard canonical RCM queue ownership"
```

---

## Final Acceptance Checklist

- [ ] Revenue Cycle navigation is exactly Charges, Rejections, Claims, Denials, Payments.
- [ ] Work Center is not visible or independently routable.
- [ ] Legacy `/charges`, `/claims/submission`, `/claims/follow-up`, `/ar-denials`, `/work-center` routes render redirects only.
- [ ] Signed-note charges and successful pre-submission scrub remain in Charges.
- [ ] Charges batches one payer at a time and owns electronic submission, 837P demo export, CMS-1500 print.
- [ ] Failed validation and clearinghouse rejection are corrected only in Rejections.
- [ ] Rejections is payer-first and correction-category second.
- [ ] Claims is payer-first with exactly seven mutually exclusive tabs.
- [ ] Claims has no validation, submission, rejection, denial, or appeal workflow controls.
- [ ] Denials is payer-first, CARC/category-driven, with Corrected Claims, Appeals, Deferred.
- [ ] Appeals exists only inside Denials.
- [ ] Payments has no Denials tab and retains underpayments plus recoupment/refund work.
- [ ] Authorization has no workqueue.
- [ ] Claim 360 remains a detail/history view, not another operational queue.
- [ ] Queue-routing contract proves mutually exclusive ownership.
- [ ] `pnpm typecheck`, `pnpm build`, and full Playwright E2E pass.
