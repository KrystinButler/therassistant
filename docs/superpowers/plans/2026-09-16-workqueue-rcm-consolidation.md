# Therassistant RCM Workqueue Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace overlapping revenue-cycle workspaces/centers with five canonical operational areas—Charges, Rejections, Claims, Denials, and Payments—while preserving existing business logic and making queue ownership mutually exclusive.

**Architecture:** Keep patient/provider/payer/detail screens as record/reference pages. Charges owns signed-note charge creation through payer batching and submission. Rejections owns both pre-submission validation failures and clearinghouse rejections. Claims owns accepted/submitted open balances and payer follow-up. Denials owns CARC-driven adjudicated denial work, corrected claims, appeals, and deferred denial work. Payments owns posting, ERA/835, unapplied funds, adjustments, underpayments, recoupments/refunds, and reversals; it does not duplicate Denials.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Wouter, Supabase demo client, Playwright, pnpm 10.28.0.

**Spec:** `docs/superpowers/specs/2026-09-16-workqueue-rcm-consolidation-design.md`

## Global Constraints

- Operational RCM navigation is exactly: Charges, Rejections, Claims, Denials, Payments.
- No Work Center UI or operational `/work-center` route remains.
- No standalone Authorization workqueue is introduced.
- No separate Claim Validation, Claim Follow-Up, Claim Submission, Insurance A/R, or Appeals workflow remains.
- `ready_for_validation` remains in Charges; only `validation_failed` moves to Rejections.
- Clearinghouse rejections also move to Rejections.
- Claims has one payer queue with mutually exclusive tabs: No Response, Deferred, 0-30 Days, 31-60 Days, 61-90 Days, 91-120 Days, 120+ Days.
- Denials has one payer queue with mutually exclusive CARC/category tabs plus Corrected Claims, Appeals, and Deferred.
- Charges owns batching by payer, electronic submission, 837P download, and CMS-1500 printing.
- Payments must retain payment posting, ERA/835, unapplied funds, adjustments/reversals, underpayment review, and recoupment/refund review.
- Existing claim detail/360, provider detail, audit/history, denial actions, and appeal actions remain available.
- Reuse current Supabase tables/status history rather than creating duplicate queue-state tables.
- A claim/charge has one primary operational home at a time.
- Use `pnpm`; do not add npm/yarn lockfiles.

---

## File Map

### New files

- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts` — pure classification helpers for operational home, Claims aging tabs, Rejection categories, and Denial tabs.
- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts` — deterministic routing tests.
- `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx` — canonical payer/correction-category Rejections UI.
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx` — canonical payer/aging Claims UI.
- `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx` — canonical payer/CARC Denials UI.
- `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts` — 837P demo text and CMS-1500 print builders.
- `artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts` — deterministic output tests.
- `artifacts/therassistant-inventory/src/navigation/sections.ts` — non-workspace navigation model.
- `e2e/rcm-workqueues.spec.ts` — canonical-route and UI acceptance tests.

### Modified files

- `artifacts/therassistant-inventory/src/App.tsx`
- `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- `artifacts/therassistant-inventory/src/navigation/workspace-navigation.css`
- `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- `artifacts/therassistant-inventory/src/domains/billing/repository.ts`
- `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- `artifacts/therassistant-inventory/src/domains/claims/workflow.ts`
- `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.types.ts`
- `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts`
- `artifacts/therassistant-inventory/src/domains/payments/PaymentsPage.tsx`
- `artifacts/therassistant-inventory/src/domains/payments/repository.ts`
- `artifacts/therassistant-inventory/src/domains/ar/ar-work-drawers.tsx`
- `artifacts/therassistant-inventory/src/pages/restored-modules.tsx`
- `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- `e2e/workspaces.spec.ts`

### Delete after references are gone

- `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- `artifacts/therassistant-inventory/src/navigation/workspaces.ts`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`
- `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts` after any reusable helper is moved to its owning domain.

---

### Task 1: Establish deterministic, mutually exclusive queue routing

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts`
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts`
- Read/reuse: `artifacts/therassistant-inventory/src/domains/claims/claim-error-guidance.ts`
- Read/reuse: `artifacts/therassistant-inventory/src/domains/ar/denials.ts`

**Interfaces:**
- Produces: `getOperationalHome(input): OperationalHome`
- Produces: `getClaimsTab(input, today): ClaimsTab`
- Produces: `getRejectionCategories(messages): RejectionCategory[]`
- Produces: `getDenialTab(input): DenialTab`

- [ ] **Step 1: Write the failing routing contract**

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

console.log("RCM queue-routing contract passed");
```

- [ ] **Step 2: Run it and verify failure**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
```

Expected: FAIL because `queue-routing.ts` does not exist.

- [ ] **Step 3: Implement the routing helpers**

Use these exact public types and ownership precedence:

```ts
export type OperationalHome = "charges" | "rejections" | "claims" | "denials" | "payments" | null;
export type ClaimsTab = "no_response" | "deferred" | "0_30" | "31_60" | "61_90" | "91_120" | "120_plus";
export type RejectionCategory = "patient" | "subscriber" | "provider" | "payer" | "diagnosis" | "procedure_modifier" | "authorization" | "claim_format" | "other";
export type DenialTab = "corrected_claims" | "appeals" | "deferred" | string;

export function getOperationalHome(input: {
  claimStatus: unknown;
  hasActiveDenial: boolean;
  openBalanceCents: number;
}): OperationalHome {
  const status = String(input.claimStatus ?? "");
  if (input.hasActiveDenial || ["denied", "appealed"].includes(status)) return "denials";
  if (["validation_failed", "rejected", "corrected"].includes(status)) return "rejections";
  if (["ready_for_validation", "ready_for_batch", "batched"].includes(status)) return "charges";
  if (["paid", "partially_paid"].includes(status) && input.openBalanceCents <= 0) return "payments";
  if (["submitted", "accepted", "partially_paid"].includes(status) && input.openBalanceCents > 0) return "claims";
  return null;
}
```

`getClaimsTab` precedence is exactly `Deferred -> No Response -> aging`. Aging uses `submittedAt` when present, otherwise `serviceDate`. `No Response` means no clearinghouse/payer acknowledgment exists after submission.

`getRejectionCategories` first uses `getClaimErrorGuidance(message)?.target`, then keyword fallback: `subscriber/member -> subscriber`, `authorization/prior auth -> authorization`, `payer -> payer`, `provider/npi/taxonomy -> provider`, `diagnosis -> diagnosis`, `cpt/hcpcs/modifier/procedure -> procedure_modifier`, `patient -> patient`, formatting/control/date/frequency/POS/charge -> claim_format`, otherwise `other`. Return unique categories in first-seen order.

`getDenialTab` precedence is exactly `Deferred -> Appeals -> Corrected Claims -> normalized denial_category -> other`.

- [ ] **Step 4: Verify contract and typecheck**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/rcm
git commit -m "feat: define canonical RCM queue routing"
```

---

### Task 2: Replace workspace navigation and establish canonical routes

**Files:**
- Create: `artifacts/therassistant-inventory/src/navigation/sections.ts`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/workspaces.spec.ts`
- Create: `e2e/rcm-workqueues.spec.ts`
- Delete: `artifacts/therassistant-inventory/src/navigation/workspaces.ts`

**Interfaces:**
- Produces: `NAV_SECTIONS`, `getVisibleSections()`, `getNavigationContext(pathname)`, `toggleExpandedSection()`.
- Canonical operational routes: `/billing/charges`, `/rejections`, `/claims`, `/denials`, `/payments`.

- [ ] **Step 1: Write failing route/navigation tests**

```ts
import { expect, test } from "@playwright/test";

const canonical = [
  ["/billing/charges", "Charges"],
  ["/rejections", "Rejections"],
  ["/claims", "Claims"],
  ["/denials", "Denials"],
  ["/payments", "Payments"],
] as const;

for (const [path, heading] of canonical) {
  test(`${heading} is canonical`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

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

test("Revenue Cycle navigation exposes only approved operational areas", async ({ page }) => {
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

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
```

- [ ] **Step 3: Create section-based navigation**

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

Keep Patients, Schedule, Clinical, Eligibility, Authorizations, Providers, Credentialing, Payers & Contracts, Mailroom, Imports, Reports, Journal, and Administration as non-RCM navigation items. Authorization stays a page, not a workqueue.

- [ ] **Step 4: Update AppShell terminology**

Use `section`/`item` names internally and:

```tsx
<nav className="thera-nav" aria-label="Primary navigation">
```

Fallback topbar context is `Operations`, not `Operational Workspace`.

- [ ] **Step 5: Add redirect component and canonical routes**

```tsx
function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <div className="thera-state">Redirecting...</div>;
}
```

During this task only, route `/rejections` to the existing Claims page and `/denials` to the existing A/R page so route tests can progress. Later tasks replace those temporary renderers. Legacy paths render `Redirect` only.

- [ ] **Step 6: Rename generic E2E smoke language**

In `e2e/workspaces.spec.ts`, rename `workspaces` to `routes` and `${heading} workspace renders` to `${heading} route renders`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git add artifacts/therassistant-inventory/src/navigation/sections.ts artifacts/therassistant-inventory/src/components/app-shell.tsx artifacts/therassistant-inventory/src/App.tsx e2e
git rm artifacts/therassistant-inventory/src/navigation/workspaces.ts
git commit -m "refactor: replace workspace navigation with RCM sections"
```

---

### Task 3: Make Charges own charge creation, payer batching, submission, 837P download, and CMS-1500 print

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Reuses: `createClaimFromCharges`, `validateClaim`, `createBatch`, `submitBatch`.
- Produces: `getBatchExportData(batchId)`.
- Produces: `build837PText(input): string`.
- Produces: `buildCms1500Html(input): string`.

- [ ] **Step 1: Write failing output-builder contract**

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

const x12 = build837PText(sample);
assert.match(x12, /ST\*837\*0001\*005010X222A1~/);
assert.match(x12, /CLM\*TH-1001\*150\.00/);
assert.match(x12, /SV1\*HC:90837\*150\.00/);
assert.match(x12, /IEA\*1\*/);

const cms = buildCms1500Html(sample.claims[0]);
assert.match(cms, /CMS-1500/);
assert.match(cms, /Demo Patient/);
assert.match(cms, /90837/);

console.log("claim output contract passed");
```

- [ ] **Step 2: Run and verify failure**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts
```

- [ ] **Step 3: Refactor BillingQueuePage into Charges**

Use heading `Charges`. Use exactly these tabs:

```ts
type ChargesTab = "ready" | "blocked" | "unbatched" | "batches" | "submitted";
```

`ready`: signed encounters ready to create charges. `blocked`: signed encounters blocked from charge creation. `unbatched`: claims in `ready_for_validation`, `ready_for_batch`, or `batched` preparation state. `batches`: payer batches ready for output/submission. `submitted`: submitted batch history.

When creating a claim from charges, call `validateClaim` immediately. `ready_for_validation` stays in Charges during the scrub. A failed scrub changes to `validation_failed` and disappears from Charges into Rejections. A passed scrub changes to `ready_for_batch` and remains in Charges.

Batch selection must enforce one payer per batch before `createBatch`:

```ts
const payerIds = new Set(selectedClaims.map((claim) => String(claim.payer_id ?? "")));
if (payerIds.size !== 1) throw new Error("A claim batch must contain one payer only.");
```

Always render toolbar buttons `Download 837P` and `Print CMS-1500`; disable them until a batch/claim selection exists. This keeps E2E deterministic.

- [ ] **Step 4: Add batch export data**

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

- [ ] **Step 5: Implement deterministic 837P demo output**

`build837PText` builds actual segment text from the provided batch data. Required sequence:

```ts
const segments = [isa, gs, st, bht];
for (const [claimIndex, item] of input.claims.entries()) {
  const controlNumber = String(item.claim.patient_control_number ?? item.claim.id);
  const total = (Number(item.claim.total_charge_cents ?? 0) / 100).toFixed(2);
  segments.push(`HL*${claimIndex + 1}**20*1~`);
  segments.push(`NM1*85*2*${clean(item.claim.providerName ?? "THERASSISTANT")}*****XX*DEMO~`);
  segments.push(`NM1*IL*1*${clean(item.claim.clientName ?? "PATIENT")}****MI*DEMO~`);
  segments.push(`CLM*${clean(controlNumber)}*${total}***11:B:1*Y*A*Y*Y~`);
  for (const [lineIndex, line] of item.lines.entries()) {
    const amount = (Number(line.charge_amount_cents ?? 0) / 100).toFixed(2);
    segments.push(`LX*${lineIndex + 1}~`);
    segments.push(`SV1*HC:${clean(line.cpt_code ?? "") }*${amount}*UN*${Number(line.units ?? 1)}***${clean(line.diagnosis_pointer ?? "1")}~`);
  }
}
segments.push(`SE*${segments.length - 1}*0001~`, `GE*1*1~`, `IEA*1*${control}~`);
return segments.join("\n");
```

Use test/demo sender and receiver IDs until real trading-partner IDs are configured. The UI labels this `837P Demo Export`, not production-certified EDI.

Download with a Blob as `therassistant-837p-<batch-id>.txt`.

- [ ] **Step 6: Implement CMS-1500 print HTML**

Render patient, payer, provider, diagnosis, service-line, charge, and total fields into a print-only 8.5x11 layout headed `CMS-1500`. Use:

```css
@page { size: 8.5in 11in; margin: 0.25in; }
.cms1500 { width: 8in; min-height: 10.5in; font: 10px Arial, sans-serif; }
```

The toolbar opens a print window, writes the HTML, calls `print()`, and closes on `afterprint`.

- [ ] **Step 7: Add Charges E2E assertions**

```ts
test("Charges owns claim outputs", async ({ page }) => {
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
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Charges"
git add artifacts/therassistant-inventory/src/domains/billing artifacts/therassistant-inventory/src/domains/claims/repository.ts e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate claim submission into Charges"
```

---

### Task 4: Build one Rejections workqueue for validation failures and clearinghouse rejections

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workflow.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Consumes: `getRejectionCategories()` and `getClaimErrorGuidance()`.
- Reuses: `validateClaim`, `retryRejectedClaims`, `ClaimWorkDrawer` correction controls.

- [ ] **Step 1: Add failing Rejections test**

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

- [ ] **Step 3: Remove Work Center as the driver of rejection membership**

`validateClaimWorkflow` continues writing claim status/history. On failure set `validation_failed`; on pass set `ready_for_batch`. Rejections derives membership from claim/response state, not a universal Work Center row. Remove user-facing messages saying anything was “routed to Work Center.”

Clearinghouse rejected responses continue setting claim status `rejected` and storing `submission_responses`.

- [ ] **Step 4: Implement RejectionsPage**

A claim qualifies when `claim_status` is `validation_failed`, `rejected`, or `corrected`, or the latest submission response is `rejected`.

Group first by `payer_id`. Within the selected payer, use `getRejectionCategories(unresolvedMessages)` to build tabs. A claim may appear in more than one Rejections category only when it has multiple unresolved correction categories.

Open `ClaimWorkDrawer`. Primary correction action is `Save & Revalidate`. Successful revalidation changes status to `ready_for_batch`, so the record disappears from Rejections and returns to Charges.

- [ ] **Step 5: Remove Denials/Appeals operational ownership from generic claim drawer**

Claim 360 may display denial/appeal history. The generic Claims/Rejections drawer does not offer Denials/Appeals workflow tabs or actions; Denials owns those actions.

- [ ] **Step 6: Wire and verify**

```tsx
<Route path="/rejections"><RejectionsPage /></Route>
```

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Rejections"
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: merge validation and rejection correction"
```

---

### Task 5: Build payer-specific Claims workqueues and remove Claims/A-R duplication

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`

**Interfaces:**
- Consumes: `getOperationalHome()` and `getClaimsTab()`.
- Claims does not validate, submit, retry rejections, create generic follow-up tasks, work denials, or work appeals.

- [ ] **Step 1: Add failing Claims structure test**

```ts
test("Claims has payer queues and approved aging tabs", async ({ page }) => {
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

- [ ] **Step 3: Expose Claims queue fields**

Extend the enriched claim row with:

```ts
type ClaimsQueueRow = ClaimsWorkspaceRow & {
  submittedAt: string | null;
  hasPayerResponse: boolean;
  deferred: boolean;
  hasActiveDenial: boolean;
};
```

`hasPayerResponse` is true when a submission response or payer claim number exists. `deferred` is true when the current claim-specific state is pending/snoozed/deferred. Reuse current state/history; do not add a duplicate queue-state table.

- [ ] **Step 4: Implement payer queues + fixed tab order**

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

Filter to `getOperationalHome(...) === "claims"`, group by payer, then assign each claim to exactly one `getClaimsTab(...)` result. Rows open Claim 360/drawer for claim details only.

- [ ] **Step 5: Wire `/claims`, delete old page, verify**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Claims"
git rm artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx
git add artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate payer follow-up into Claims workqueues"
```

---

### Task 6: Build payer/CARC Denials workqueues

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`
- Delete: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`

**Interfaces:**
- Consumes: `getDenialTab()`.
- Reuses: `startDenialWork`, `createDenialAppeal`, `submitAppeal`, `recordAppealOutcome`, `writeOffDenial`, existing denial/appeal drawers.

- [ ] **Step 1: Add failing Denials test**

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

- [ ] **Step 3: Expose only denial-domain data**

Add `getDenialsQueueData()` that directly returns `denials`, `appeals`, `payers`, `providers`, and linked claim fields required for corrected-claim detection. Do not return Insurance A/R, Patient A/R, variance, or recovery arrays to `DenialsPage`.

- [ ] **Step 4: Implement DenialsPage**

Group by payer. For the selected payer, determine exactly one tab:

```ts
getDenialTab({
  deferred: denial.workStatus === "pending" || denial.workStatus === "snoozed",
  appealActive: activeAppealByDenial.has(denial.id),
  correctedClaim: denial.denial_status === "corrected_claim" || linkedClaim.claim_frequency_code === "7",
  denialCategory: denial.denial_category ?? "other",
});
```

Render normalized denial-category tabs first, then `Corrected Claims`, `Appeals`, `Deferred`. Show CARC, RARC, denial reason, amount, deadline, and status. Use existing denial/appeal drawers for actions.

- [ ] **Step 5: Remove Work Center/A-R wording from denial actions**

Change history text to `Denial work started from Denials.` / `Denial work resumed from Denials.` Internal `workqueue_items` may remain for local status/audit, but there is no universal Work Center UI.

- [ ] **Step 6: Wire, verify, delete old mixed page, commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Denials"
git rm artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx
git add artifacts/therassistant-inventory/src/domains/ar artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate CARC-driven Denials workqueues"
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
- Payments tabs become: Insurance Payments, Patient Payments, ERA / 835, Unapplied, Adjustments / Reversals, Underpayments, Recoupments / Refunds.
- Denials never renders inside Payments.
- Reuses the current variance/recovery data and drawers from the old mixed A/R page.

- [ ] **Step 1: Add failing Payments ownership test**

```ts
test("Payments owns payment exceptions but not denials", async ({ page }) => {
  await page.goto("/payments");
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Underpayments/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Recoupments \/ Refunds/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Denials/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Payments owns"
```

- [ ] **Step 3: Add variance/recovery data to Payments repository**

Move or reuse the existing `variances` and `recovery` queries from `ar/repository.ts` in `getPaymentsWorkspaceData()`. Keep one query implementation; if moved, remove the duplicate from `getArWorkspaceData()` after Denials no longer uses it.

- [ ] **Step 4: Replace Payments Denials tab**

Remove `exceptions`/Denials from `PaymentsPage`. Add:

```ts
type Tab = "insurance" | "patient" | "era" | "unapplied" | "adjustments" | "underpayments" | "recovery";
```

Use existing `UnderpaymentReviewDrawer` and `RecoveryReviewDrawer` in these tabs.

Rename the current route-to-Work-Center actions at the UI boundary to `Start Work`. The internal repository may continue creating/updating a local `workqueue_item`, but the row remains visible and actionable inside Payments; no separate center is required.

When `runDenied` creates a denial from ERA adjudication, show `Denial recorded and moved to Denials.` Do not show the denial table in Payments.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Payments"
git add artifacts/therassistant-inventory/src/domains/payments artifacts/therassistant-inventory/src/domains/ar/repository.ts artifacts/therassistant-inventory/src/domains/ar/ar-work-drawers.tsx e2e/rcm-workqueues.spec.ts
git commit -m "refactor: consolidate payment exceptions into Payments"
```

---

### Task 8: Remove duplicate workflow pages, Work Center, and stale links

**Files:**
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/restored-modules.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- Delete: `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts` after remaining imports are moved.
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Legacy URLs are redirects only.
- No source import renders WorkCenterPage, ClaimFollowUpPage, ClaimSubmissionPage, ClaimsWorkspacePage, or ArWorkspacePage.

- [ ] **Step 1: Add failing retired-name regression test**

```ts
test("retired workflow names are not visible", async ({ page }) => {
  await page.goto("/");
  for (const label of ["Work Center", "Claim Follow-Up", "Insurance A/R", "Claim Submission / 837P", "A/R & Denials"]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Delete duplicate UI implementations**

Remove `ClaimFollowUpPage` from `restored-modules.tsx`. Delete `work-center.tsx` and `ClaimSubmissionPage.tsx`. Delete the old multi-purpose `claims/workqueues.ts` after moving `isActiveAppealStatus` to the denial domain if still required.

- [ ] **Step 3: Update dashboard/billing links**

All RCM operational links point only to:

```text
Charges -> /billing/charges
Rejections -> /rejections
Claims -> /claims
Denials -> /denials
Payments -> /payments
```

Remove separate A/R, Claim Follow-Up, Claim Submission, and Work Center cards/links.

- [ ] **Step 4: Search for stale imports/copy**

```bash
rg -n "Work Center|WorkCenterPage|Claim Follow-Up|ClaimFollowUpPage|ClaimSubmissionPage|ClaimsWorkspacePage|ArWorkspacePage|Insurance A/R|A/R & Denials" artifacts/therassistant-inventory/src e2e
```

Expected: only intentional legacy redirect test strings remain.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck
pnpm build
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
git add artifacts/therassistant-inventory/src e2e/rcm-workqueues.spec.ts
git rm artifacts/therassistant-inventory/src/pages/work-center.tsx artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx
git commit -m "refactor: remove duplicate revenue cycle workflows"
```

---

### Task 9: Full verification and duplicate-workflow guardrails

**Files:**
- Modify: `e2e/rcm-workqueues.spec.ts`
- Modify: `e2e/workspaces.spec.ts`

**Interfaces:**
- Final tests prevent records from appearing in multiple canonical workqueues/tabs after state transitions.

- [ ] **Step 1: Add end-to-end transition assertions**

Use the existing synthetic/demo controls and records to verify:

```text
Signed note -> charge appears in Charges
Charge -> claim -> successful validation -> Charges ready for batch
Validation failure -> Rejections and absent from Charges
Clearinghouse rejection -> Rejections and absent from Claims
Successful submission/acceptance with open balance -> Claims and absent from Charges/Rejections
Active denial/CARC -> Denials and absent from Claims/Payments denial views
Appeal -> Denials > Appeals only
Deferred claim -> Claims > Deferred only
Deferred denial -> Denials > Deferred only
Paid/zero-balance claim -> absent from Claims and Denials; payment remains in Payments/history
```

- [ ] **Step 2: Guard Claims tab uniqueness**

For one selected payer and claim control number, visit all seven Claims tabs and count matches. Assert total count is `<= 1`.

- [ ] **Step 3: Guard Denials tab uniqueness**

For one denial ID/control number, visit all denial-reason tabs plus Corrected Claims, Appeals, Deferred. Assert total count is `<= 1`.

- [ ] **Step 4: Run full verification**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/billing/claim-output.contract.test.ts
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 5: Review stale terminology**

```bash
rg -n "workspace|work center|claim follow-up|insurance a/r" artifacts/therassistant-inventory/src/domains artifacts/therassistant-inventory/src/components artifacts/therassistant-inventory/src/navigation
```

Every user-facing match must be removed. Internal CSS class names may remain only when they do not surface terminology and renaming would add unrelated risk.

- [ ] **Step 6: Final commit**

```bash
git add e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git commit -m "test: guard canonical RCM workqueue ownership"
```

---

## Final Acceptance Checklist

- [ ] Revenue Cycle navigation exposes exactly Charges, Rejections, Claims, Denials, Payments.
- [ ] `/work-center` no longer renders a Work Center and redirects away.
- [ ] `/claims/follow-up`, `/claims/submission`, `/ar-denials`, and `/charges` do not render duplicate workflows.
- [ ] Signed-note charges are created and worked from Charges.
- [ ] `ready_for_validation` stays in Charges; `validation_failed` moves to Rejections.
- [ ] Charges batches by one payer and owns electronic submission, 837P demo download, and CMS-1500 printing.
- [ ] Validation failures and clearinghouse rejections are corrected only in Rejections.
- [ ] Rejections groups by payer and unresolved correction category.
- [ ] Claims has one queue per payer and exactly the seven approved tabs.
- [ ] Claims does not contain validation, rejection, denial, appeal, or submission tabs/actions.
- [ ] Denials has one queue per payer, dynamic CARC/category tabs, and Corrected Claims/Appeals/Deferred.
- [ ] Appeals exist only inside Denials.
- [ ] Payments does not duplicate Denials.
- [ ] Payments retains underpayments and recoupment/refund review from the retired mixed A/R page.
- [ ] Authorization remains record/context data only; no authorization workqueue exists.
- [ ] Claim 360/detail history remains available without becoming a second operational queue.
- [ ] Queue-routing tests prove mutually exclusive Claims and Denials ownership.
- [ ] `pnpm typecheck`, `pnpm build`, and full Playwright E2E pass.
