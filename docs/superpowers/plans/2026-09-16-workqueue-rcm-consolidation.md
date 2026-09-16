# Therassistant RCM Workqueue Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace overlapping revenue-cycle workspaces/centers with five canonical operational areas—Charges, Rejections, Claims, Denials, and Payments—while preserving existing business logic and making queue ownership mutually exclusive.

**Architecture:** Keep patient/provider/payer/detail screens as record/reference pages. Move all pre-submission billing and submission actions into Charges, all submission-blocking and clearinghouse corrections into Rejections, all accepted/outstanding payer follow-up into payer-specific Claims queues, and all CARC-driven adjudicated denials into payer-specific Denials queues. Preserve existing repository/workflow functions wherever possible; add only the queue-classification/export logic needed to support the approved model, then delete or redirect duplicate routes and dead UI.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Wouter, Supabase demo client, Playwright, pnpm 10.28.0.

**Spec:** `docs/superpowers/specs/2026-09-16-workqueue-rcm-consolidation-design.md`

## Global Constraints

- Operational RCM navigation is: Charges, Rejections, Claims, Denials, Payments.
- No Work Center UI or `/work-center` operational route remains.
- No standalone Authorization workqueue is introduced.
- No separate Claim Validation, Claim Follow-Up, Claim Submission, Insurance A/R, or Appeals workflow remains.
- Validation failures and clearinghouse rejections share one Rejections flow.
- Claims has one payer queue with mutually exclusive tabs: No Response, Deferred, 0-30, 31-60, 61-90, 91-120, 120+.
- Denials has one payer queue with mutually exclusive CARC/category tabs plus Corrected Claims, Appeals, and Deferred.
- Charges owns batching by payer, electronic submission, 837P download, and CMS-1500 printing.
- Existing claim detail/360, provider detail, payment posting, audit/history, denial actions, and appeal actions remain available.
- Reuse current Supabase tables/status history rather than creating duplicate queue-state tables.
- A claim/charge has one primary operational home at a time.
- Use `pnpm`; do not add npm/yarn lockfiles.

---

## File Map

### New files

- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts` — pure classification helpers for queue ownership, Claims aging tabs, Rejection correction categories, and Denial tabs.
- `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts` — deterministic contract tests for mutually exclusive queue assignment.
- `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx` — canonical payer/correction-category Rejections UI.
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx` — canonical payer/aging Claims UI.
- `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx` — canonical payer/CARC Denials UI, including Corrected Claims, Appeals, Deferred.
- `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts` — downloadable 837P demo text builder and CMS-1500 printable document builder.
- `artifacts/therassistant-inventory/src/navigation/sections.ts` — non-workspace navigation model.
- `e2e/rcm-workqueues.spec.ts` — route and queue-structure acceptance tests.

### Modified files

- `artifacts/therassistant-inventory/src/App.tsx` — canonical routes and legacy redirects.
- `artifacts/therassistant-inventory/src/components/app-shell.tsx` — navigation terminology/model migration.
- `artifacts/therassistant-inventory/src/navigation/workspace-navigation.css` — keep visual styling but remove user-facing workspace assumptions as needed.
- `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx` — becomes the canonical Charges screen and absorbs batching/submission/export actions.
- `artifacts/therassistant-inventory/src/domains/billing/repository.ts` — expose charge/claim context needed by Charges.
- `artifacts/therassistant-inventory/src/domains/claims/repository.ts` — expose batch export/submission data and preserve submission response logic.
- `artifacts/therassistant-inventory/src/domains/claims/workflow.ts` — stop routing rejection corrections to Work Center; keep status/history transitions.
- `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx` — remove duplicate Denials/Appeals ownership from generic claim work sections where those actions belong in Denials.
- `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts` — retire old multi-workspace queue builder after new routing helper is in use.
- `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts` — retain shared enriched claim data but remove Work Center follow-up creation from Claims UI dependencies.
- `artifacts/therassistant-inventory/src/domains/ar/repository.ts` — feed Denials canonical payer/category views without mixed Insurance A/R ownership.
- `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts` — update history copy and preserve appeal/corrected-claim actions without Work Center UI dependency.
- `artifacts/therassistant-inventory/src/pages/restored-modules.tsx` — remove `ClaimFollowUpPage` and obsolete duplicate workflow exports.
- `artifacts/therassistant-inventory/src/pages/dashboard.tsx` — update links/labels that point at retired workflows.
- `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx` — update routing cards/links if retained as a summary page; do not present it as another operational workspace.
- `e2e/workspaces.spec.ts` — rename/reframe generic route smoke coverage so it no longer calls operational screens workspaces.

### Deleted after references are gone

- `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- `artifacts/therassistant-inventory/src/navigation/workspaces.ts`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`
- `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`

---

### Task 1: Establish one deterministic queue-routing model

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts`
- Create: `artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts`
- Read/reuse: `artifacts/therassistant-inventory/src/domains/claims/claim-error-guidance.ts`
- Read/reuse: `artifacts/therassistant-inventory/src/domains/ar/denials.ts`

**Interfaces:**
- Produces: `getOperationalHome(input): OperationalHome`
- Produces: `getClaimsTab(input, today): ClaimsTab | null`
- Produces: `getRejectionCategories(messages): RejectionCategory[]`
- Produces: `getDenialTab(input): DenialTab`
- Consumes later: Charges/Rejections/Claims/Denials pages and route tests.

- [ ] **Step 1: Write the failing routing contract test**

Create `queue-routing.contract.test.ts` with explicit examples and uniqueness assertions:

```ts
import assert from "node:assert/strict";
import {
  getClaimsTab,
  getDenialTab,
  getOperationalHome,
  getRejectionCategories,
} from "./queue-routing.ts";

const today = new Date("2026-09-16T12:00:00Z");

assert.equal(
  getOperationalHome({ claimStatus: "rejected", hasActiveDenial: false, openBalanceCents: 10000 }),
  "rejections",
);
assert.equal(
  getOperationalHome({ claimStatus: "denied", hasActiveDenial: true, openBalanceCents: 10000 }),
  "denials",
);
assert.equal(
  getOperationalHome({ claimStatus: "submitted", hasActiveDenial: false, openBalanceCents: 10000 }),
  "claims",
);
assert.equal(
  getOperationalHome({ claimStatus: "paid", hasActiveDenial: false, openBalanceCents: 0 }),
  "payments",
);

assert.equal(
  getClaimsTab({ deferred: true, submittedAt: "2026-06-01", serviceDate: "2026-05-30", hasPayerResponse: false }, today),
  "deferred",
);
assert.equal(
  getClaimsTab({ deferred: false, submittedAt: "2026-09-10", serviceDate: "2026-09-01", hasPayerResponse: false }, today),
  "no_response",
);
assert.equal(
  getClaimsTab({ deferred: false, submittedAt: "2026-09-01", serviceDate: "2026-08-20", hasPayerResponse: true }, today),
  "0_30",
);
assert.equal(
  getClaimsTab({ deferred: false, submittedAt: "2026-07-15", serviceDate: "2026-07-15", hasPayerResponse: true }, today),
  "61_90",
);

assert.deepEqual(
  getRejectionCategories(["Patient is missing.", "Claim line CPT/HCPCS is missing."]),
  ["patient", "procedure_modifier"],
);

assert.equal(getDenialTab({ deferred: true, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "deferred");
assert.equal(getDenialTab({ deferred: false, appealActive: true, correctedClaim: true, denialCategory: "coding" }), "appeals");
assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: true, denialCategory: "coding" }), "corrected_claims");
assert.equal(getDenialTab({ deferred: false, appealActive: false, correctedClaim: false, denialCategory: "timely_filing" }), "timely_filing");

console.log("RCM queue-routing contract passed");
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
```

Expected: FAIL because `queue-routing.ts` does not exist.

- [ ] **Step 3: Implement minimal mutually exclusive routing helpers**

Create `queue-routing.ts` with these exact public types and precedence:

```ts
import { getClaimErrorGuidance } from "../claims/claim-error-guidance";

export type OperationalHome = "charges" | "rejections" | "claims" | "denials" | "payments" | null;
export type ClaimsTab = "no_response" | "deferred" | "0_30" | "31_60" | "61_90" | "91_120" | "120_plus";
export type RejectionCategory =
  | "patient"
  | "subscriber"
  | "provider"
  | "payer"
  | "diagnosis"
  | "procedure_modifier"
  | "authorization"
  | "claim_format"
  | "other";
export type DenialTab = "corrected_claims" | "appeals" | "deferred" | string;

export function getOperationalHome(input: {
  claimStatus: unknown;
  hasActiveDenial: boolean;
  openBalanceCents: number;
}): OperationalHome {
  const status = String(input.claimStatus ?? "");
  if (["ready_for_validation", "validation_failed", "rejected", "corrected"].includes(status)) return "rejections";
  if (input.hasActiveDenial || ["denied", "appealed"].includes(status)) return "denials";
  if (["paid", "partially_paid"].includes(status) && input.openBalanceCents <= 0) return "payments";
  if (["ready_for_batch", "batched"].includes(status)) return "charges";
  if (["submitted", "accepted", "partially_paid"].includes(status) && input.openBalanceCents > 0) return "claims";
  return null;
}
```

Implement `getClaimsTab` with precedence `Deferred -> No Response -> age bucket`. Use submission date when present; fall back to service date. `No Response` means the claim has been submitted but no payer/clearinghouse response has been recorded. Age tabs apply once a response/acknowledgment exists and a balance remains.

Implement `getRejectionCategories` by mapping guidance targets:

```ts
const targetCategory = {
  patient: "patient",
  patient_control_number: "patient",
  rendering_provider: "provider",
  payer: "payer",
  diagnoses: "diagnosis",
  claim_lines: "procedure_modifier",
  service_date_from: "claim_format",
  service_date_to: "claim_format",
  place_of_service_code: "claim_format",
  claim_frequency_code: "claim_format",
  total_charge_cents: "claim_format",
  payer_claim_number: "claim_format",
} as const;
```

Unmapped messages return `other`; preserve multiple categories when one claim has multiple unresolved errors.

Implement `getDenialTab` with precedence `Deferred -> Appeals -> Corrected Claims -> normalized denial_category -> other`. This prevents one denial from appearing in multiple Denials tabs simultaneously.

- [ ] **Step 4: Run the contract and typecheck**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/rcm/queue-routing.ts \
  artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
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
- Delete after migration: `artifacts/therassistant-inventory/src/navigation/workspaces.ts`

**Interfaces:**
- Produces: `NAV_SECTIONS`, `getVisibleSections()`, `getNavigationContext(pathname)`, `toggleExpandedSection()`.
- Canonical operational routes: `/billing/charges`, `/rejections`, `/claims`, `/denials`, `/payments`.
- Legacy routes redirect; they never mount old workflow components.

- [ ] **Step 1: Write failing route/navigation E2E tests**

Create the initial `e2e/rcm-workqueues.spec.ts`:

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
  test(`${heading} is a canonical RCM route`, async ({ page }) => {
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

test("revenue cycle navigation has only the approved operational areas", async ({ page }) => {
  await page.goto("/claims");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  for (const label of ["Charges", "Rejections", "Claims", "Denials", "Payments"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByText("Work Center", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Claim Follow-Up", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("Claim Submission / 837P", { exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the new E2E file and verify failures**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
```

Expected: failures for missing `/rejections`, `/denials`, redirects, headings, and old navigation.

- [ ] **Step 3: Create the section-based navigation model**

Move the useful path-matching behavior from `workspaces.ts` into `sections.ts`, but use section/item terminology. The Revenue Cycle section must be exactly:

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

Keep Patients, Schedule, Clinical, Eligibility, Authorizations, Providers, Credentialing, Payers & Contracts, Mailroom, Imports, Reports, Journal, and Administration as record/reference/navigation items. Authorization remains a page but not a workqueue.

- [ ] **Step 4: Update AppShell terminology**

Change imports and internal variable names from workspace to section. User-facing changes must include:

```tsx
<nav className="thera-nav" aria-label="Primary navigation">
```

and fallback topbar copy:

```ts
const topbarContext = context.section
  ? context.item
    ? `${context.section.label} · ${context.item.label}`
    : context.section.label
  : "Operations";
```

The CSS class names may remain temporarily if changing them adds no user-visible value; do not display “Workspace” or “Work Center”.

- [ ] **Step 5: Add canonical routes and legacy redirect component**

Use a small redirect component in `App.tsx`:

```tsx
import { useEffect } from "react";
import { useLocation } from "wouter";

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return <div className="thera-state">Redirecting...</div>;
}
```

Wire canonical placeholders initially to the existing implementations so tests can advance incrementally:

```tsx
<Route path="/billing/charges"><BillingQueuePage /></Route>
<Route path="/rejections"><ClaimsWorkspacePage /></Route>
<Route path="/claims"><ClaimsWorkspacePage /></Route>
<Route path="/denials"><ArWorkspacePage /></Route>
<Route path="/payments"><PaymentsPage /></Route>
<Route path="/charges"><Redirect to="/billing/charges" /></Route>
<Route path="/claims/submission"><Redirect to="/billing/charges" /></Route>
<Route path="/claims/follow-up"><Redirect to="/claims" /></Route>
<Route path="/ar-denials"><Redirect to="/denials" /></Route>
<Route path="/work-center"><Redirect to="/claims" /></Route>
```

Do not delete old pages yet; later tasks replace the placeholder renderers.

- [ ] **Step 6: Update the generic smoke test terminology**

In `e2e/workspaces.spec.ts`, rename the array to `routes` and tests to `${heading} route renders`; remove “workspace” from test names. Keep non-RCM route smoke coverage.

- [ ] **Step 7: Run E2E/typecheck and commit**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git add artifacts/therassistant-inventory/src/navigation/sections.ts \
  artifacts/therassistant-inventory/src/components/app-shell.tsx \
  artifacts/therassistant-inventory/src/App.tsx \
  e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git rm artifacts/therassistant-inventory/src/navigation/workspaces.ts
git commit -m "refactor: replace workspace navigation with canonical RCM routes"
```

---

### Task 3: Make Charges own creation, payer batching, submission, 837P download, and CMS-1500 print

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/claim-output.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Reuses: `createClaimFromCharges`, `validateClaim`, `createBatch`, `submitBatch` from claims repository.
- Produces: `getBatchExportData(batchId)` in claims repository.
- Produces: `build837PText(data): string`.
- Produces: `buildCms1500Html(claim): string`.

- [ ] **Step 1: Add failing Charges acceptance tests**

Append to `e2e/rcm-workqueues.spec.ts`:

```ts
test("Charges owns submission outputs", async ({ page }) => {
  await page.goto("/billing/charges");
  await expect(page.getByRole("heading", { level: 1, name: "Charges" })).toBeVisible();
  await expect(page.getByText("Batch by Payer", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download 837P/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Print CMS-1500/i }).first()).toBeVisible();
});
```

If demo data does not guarantee an existing batch, seed/create one through the current demo controls before asserting buttons; do not weaken the test to source-string matching.

- [ ] **Step 2: Run the test and confirm failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Charges owns submission outputs"
```

Expected: FAIL because Charges still renders the old Billing heading and links away to Claim Submission.

- [ ] **Step 3: Refactor BillingQueuePage into the canonical Charges UI**

Change header copy to:

```tsx
<div className="thera-eyebrow">REVENUE CYCLE</div>
<h1>Charges</h1>
<p>Signed notes become charges here, then charges are grouped by payer and submitted electronically, exported as 837P, or printed to CMS-1500.</p>
```

Remove the `Claim Submission` link. Replace the old encounter-centric tab model with tabs that keep the useful readiness path but converge on charge/submission work, for example:

```ts
type ChargesTab = "ready" | "blocked" | "unbatched" | "batches" | "submitted";
```

The `unbatched` view groups ready charges by payer. Selecting charges for a batch must reject mixed payers before calling `createBatch`.

After `createClaimFromCharges`, immediately run `validateClaim`. A failed validation remains a persisted claim but routes to Rejections; a successful validation becomes `ready_for_batch` and stays visible in Charges.

- [ ] **Step 4: Add batch export data access**

In `claims/repository.ts`, add:

```ts
export async function getBatchExportData(batchId: string) {
  const batch = await repository.getBatch(batchId);
  if (!batch) throw new Error("Claim batch not found.");
  const claims = await repository.getBatchClaims(batchId);
  const claimsWithLines = await Promise.all(
    claims.map(async (claim) => ({
      claim,
      lines: await repository.getClaimLines(claim.id),
      diagnoses: await repository.getClaimDiagnoses(claim.id),
    })),
  );
  return { batch, claims: claimsWithLines };
}
```

Use enriched patient/provider/payer data already available in `getClaimSubmissionData()` when displaying the batch; do not add duplicate tables.

- [ ] **Step 5: Implement downloadable 837P demo text**

Create `claim-output.ts`. The builder must return a deterministic X12-style professional-claim transaction and clearly identify itself as synthetic/demo until full trading-partner configuration exists:

```ts
export function build837PText(input: BatchExportData): string {
  const control = String(input.batch.id).replace(/\D/g, "").slice(-9).padStart(9, "0");
  const segments = [
    `ISA*00*          *00*          *ZZ*THERASSISTANT   *ZZ*DEMO_PAYER      *260916*1200*^*00501*${control}*0*T*:~`,
    `GS*HC*THERASSISTANT*DEMO_PAYER*20260916*1200*1*X*005010X222A1~`,
    `ST*837*0001*005010X222A1~`,
    `BHT*0019*00*${control}*20260916*1200*CH~`,
    // append one CLM loop and SV1 segments for each claim/line
    `SE*${segmentCount}*0001~`,
    `GE*1*1~`,
    `IEA*1*${control}~`,
  ];
  return segments.join("\n");
}
```

Do not label the file production-compliant unless required ISA/GS/NM1 trading-partner identifiers and loops are configured. Download using a Blob with filename `therassistant-837p-<batch>.txt`.

- [ ] **Step 6: Implement CMS-1500 print output**

`buildCms1500Html` should create one printable claim sheet per claim with the CMS-1500 field structure populated from available claim/client/provider/payer data. Use print CSS:

```css
@page { size: 8.5in 11in; margin: 0.25in; }
.cms1500 { width: 8in; min-height: 10.5in; font: 10px Arial, sans-serif; }
```

The Charges button opens a print window, writes the generated HTML, calls `print()`, and closes on `afterprint`. Keep this output isolated from the main app DOM.

- [ ] **Step 7: Run tests/typecheck/build and commit**

```bash
pnpm typecheck
pnpm build
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Charges"
git add artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx \
  artifacts/therassistant-inventory/src/domains/billing/repository.ts \
  artifacts/therassistant-inventory/src/domains/claims/repository.ts \
  artifacts/therassistant-inventory/src/domains/billing/claim-output.ts \
  e2e/rcm-workqueues.spec.ts
git commit -m "feat: consolidate claim submission into Charges"
```

---

### Task 4: Build the single Rejections workqueue and merge validation/rejection correction

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workflow.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Consumes: `getRejectionCategories()` and current `getClaimErrorGuidance()`.
- Reuses: `validateClaim`, `retryRejectedClaims`, `ClaimWorkDrawer` correction controls.
- Rejections grouping: payer -> correction category.

- [ ] **Step 1: Add failing Rejections UI tests**

```ts
test("Rejections is grouped by payer and correction category", async ({ page }) => {
  await page.goto("/rejections");
  await expect(page.getByRole("heading", { level: 1, name: "Rejections" })).toBeVisible();
  await expect(page.getByText(/payer/i).first()).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Rejection categories" })).toBeVisible();
  await expect(page.getByText("Validation", { exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Rejections is grouped"
```

- [ ] **Step 3: Stop creating Work Center tasks for validation/rejection routing**

In `validateClaimWorkflow`, retain claim status/history but remove the requirement that an open `claim_validation` work item drives the UI. It may keep an internal audit work item only if other code still depends on it, but Rejections must derive membership from claim status + response errors, not Work Center assignment.

For clearinghouse rejection, update the status/history message to state that the claim is available in Rejections; remove “routed to Work Center” copy from both workflow and UI.

- [ ] **Step 4: Implement RejectionsPage**

Load enriched claims, submission responses, and current validation findings. A claim qualifies when:

```ts
const rejected = ["validation_failed", "rejected", "corrected"].includes(String(row.claim_status))
  || latestResponse?.response_status === "rejected";
```

Render payer selector/cards first. Once a payer is selected, derive tabs from unresolved messages using `getRejectionCategories()`. A claim may appear under multiple correction-category tabs only when it has multiple unresolved correction categories.

Open `ClaimWorkDrawer` directly for correction. The primary action is `Save & Revalidate`; successful revalidation removes the claim from Rejections and returns it to Charges (`ready_for_batch`).

- [ ] **Step 5: Remove duplicate correction ownership from the generic claim page/drawer**

Keep fields, lines, diagnoses, responses, history available in Claim 360. Remove top-level generic drawer sections that imply Claims owns Denials/Appeals work. The Rejections drawer may show validation/rejection guidance because it owns corrections.

- [ ] **Step 6: Wire `/rejections` to RejectionsPage and verify**

```tsx
<Route path="/rejections"><RejectionsPage /></Route>
```

Run:

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Rejections"
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims/RejectionsPage.tsx \
  artifacts/therassistant-inventory/src/domains/claims/workflow.ts \
  artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts \
  artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx \
  artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git commit -m "feat: merge claim validation and rejection correction"
```

---

### Task 5: Replace Claims workspace/A-R duplication with payer-specific Claims workqueues

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`
- Delete after migration: `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`

**Interfaces:**
- Consumes: `getOperationalHome()` and `getClaimsTab()`.
- Uses existing enriched claim financial fields: `openBalanceCents`, payer, provider, DOS, submission/response signals.
- Claims does not validate, submit, work denials, or create generic follow-up tasks.

- [ ] **Step 1: Add failing Claims structure test**

```ts
test("Claims has payer queues and the approved mutually exclusive tabs", async ({ page }) => {
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
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Claims has payer queues"
```

- [ ] **Step 3: Expose the Claims follow-up dataset without Work Center creation**

Keep the current enriched claim ledger query, but remove `createClaimFollowUps` from page dependencies. Ensure each row has:

```ts
type ClaimsQueueRow = ClaimsWorkspaceRow & {
  submittedAt: string | null;
  hasPayerResponse: boolean;
  deferred: boolean;
  hasActiveDenial: boolean;
};
```

Derive `hasPayerResponse` from submission responses/payer claim number. Derive `deferred` from the existing pending/snoozed/deferred state if present; do not add a second boolean column if current work/audit state can represent it.

- [ ] **Step 4: Build ClaimsPage around payer selection + tabs**

Filter first to records whose operational home is `claims`. Group by `payer_id`. Require the user to select a payer queue, then classify every remaining claim with exactly one `ClaimsTab`.

Use this fixed UI ordering:

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

Rows open the existing claim drawer/Claim 360 for details. Remove Validate, Retry Rejected, Create Follow-Up, Denial, and Appeal bulk actions from this screen.

- [ ] **Step 5: Wire canonical `/claims`, delete old page, and run tests**

```tsx
<Route path="/claims"><ClaimsPage /></Route>
```

Then:

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Claims"
```

Delete `ClaimsWorkspacePage.tsx` only after imports are gone.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx \
  artifacts/therassistant-inventory/src/domains/claims/workspace-repository.ts \
  artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git rm artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx
git commit -m "feat: consolidate payer follow-up into Claims workqueues"
```

---

### Task 6: Replace mixed A/R workspace with payer/CARC Denials workqueues

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `e2e/rcm-workqueues.spec.ts`
- Delete after migration: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`

**Interfaces:**
- Consumes: `getDenialTab()`.
- Reuses: `startDenialWork`, `createDenialAppeal`, `submitAppeal`, `recordAppealOutcome`, `writeOffDenial` and existing drawers.
- Denials page owns corrected-claim and appeal disposition; there is no separate Appeals route/workflow.

- [ ] **Step 1: Add failing Denials UI test**

```ts
test("Denials is payer-specific and CARC driven", async ({ page }) => {
  await page.goto("/denials");
  await expect(page.getByRole("heading", { level: 1, name: "Denials" })).toBeVisible();
  await expect(page.getByText(/CARC/i).first()).toBeVisible();
  for (const tab of ["Corrected Claims", "Appeals", "Deferred"]) {
    await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
  }
  await expect(page.getByRole("tab", { name: "Insurance A/R", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Patient A/R", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Underpayments", exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Denials is payer-specific"
```

- [ ] **Step 3: Provide a denial-focused repository result**

Expose a function such as:

```ts
export async function getDenialsQueueData() {
  const data = await getArWorkspaceData();
  return {
    denials: data.denials,
    appeals: data.appeals,
    payers: data.payers,
    providers: data.providers,
  };
}
```

If `getArWorkspaceData()` is too broad, replace it with direct denial/appeal/payer queries during this task. Do not carry Insurance A/R, Patient A/R, variance, or recovery arrays into `DenialsPage`.

- [ ] **Step 4: Build DenialsPage**

Group denials by payer. For the selected payer, calculate the one active tab per denial with:

```ts
getDenialTab({
  deferred: denial.workStatus === "pending" || denial.workStatus === "snoozed",
  appealActive: activeAppealByDenial.has(denial.id),
  correctedClaim: denial.denial_status === "corrected_claim" || claim.claim_frequency_code === "7",
  denialCategory: denial.denial_category ?? "other",
});
```

Render dynamic reason tabs from normalized `denial_category`; always append `Corrected Claims`, `Appeals`, `Deferred`. Show CARC/RARC and reason in the table so the queue is visibly CARC-driven.

Use the existing denial/appeal drawers for actions. Appeals remain embedded in the selected payer Denials workqueue.

- [ ] **Step 5: Remove Work Center wording from denial history/actions**

Change history copy such as:

```ts
"Denial work started from A/R workspace."
```

to:

```ts
"Denial work started from Denials."
```

Do not delete internal `workqueue_items` history if the denial actions still use it for state/audit; simply stop exposing a universal Work Center.

- [ ] **Step 6: Wire `/denials`, delete ArWorkspacePage after imports are gone, and verify**

```bash
pnpm typecheck
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts -g "Denials"
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/ar/DenialsPage.tsx \
  artifacts/therassistant-inventory/src/domains/ar/repository.ts \
  artifacts/therassistant-inventory/src/domains/ar/denial-repository.ts \
  artifacts/therassistant-inventory/src/App.tsx e2e/rcm-workqueues.spec.ts
git rm artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx
git commit -m "feat: consolidate CARC-driven denial workqueues"
```

---

### Task 7: Remove duplicate workflow pages, Work Center, and stale links

**Files:**
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/restored-modules.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.types.ts`
- Delete: `artifacts/therassistant-inventory/src/pages/work-center.tsx`
- Delete: `artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx`
- Delete or reduce: `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Legacy URLs remain redirects only.
- No source import should render WorkCenterPage, ClaimFollowUpPage, ClaimSubmissionPage, ClaimsWorkspacePage, or ArWorkspacePage.

- [ ] **Step 1: Add a failing source/route regression test**

Append a Playwright-facing regression plus a static contract if needed. At minimum:

```ts
test("retired workflow names are not visible", async ({ page }) => {
  await page.goto("/");
  for (const label of ["Work Center", "Claim Follow-Up", "Insurance A/R", "Claim Submission / 837P"]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Remove ClaimFollowUpPage from restored modules**

Delete only the duplicate export/function and its route use. Keep Clinical, Golden Thread, Imports, Journal, Medicaid until separately replaced.

- [ ] **Step 3: Remove Work Center page/import**

Delete `pages/work-center.tsx` and remove the import from `App.tsx`. Keep `workqueue_items` tables/repositories only where they support local queue state/history.

- [ ] **Step 4: Remove standalone ClaimSubmissionPage**

Delete `ClaimSubmissionPage.tsx`; Charges now owns those actions. `/claims/submission` remains only as a redirect to `/billing/charges`.

- [ ] **Step 5: Retire old workqueue builder if no longer referenced**

Remove `buildClaimWorkqueues`, old validation/submission/denials/appeals aggregation, and bulk follow-up concepts from `claims/workqueues.ts`. If `isActiveAppealStatus` remains useful, move it to the denial domain rather than keeping a misleading multi-workspace queue file.

- [ ] **Step 6: Update dashboard/billing summary links**

All operational links must point to one of the canonical areas:

```text
Charges -> /billing/charges
Rejections -> /rejections
Claims -> /claims
Denials -> /denials
Payments -> /payments
```

Do not show a separate A/R, Claim Follow-Up, Claim Submission, or Work Center card.

- [ ] **Step 7: Run repository-wide search and verification**

Run:

```bash
rg -n "Work Center|WorkCenterPage|Claim Follow-Up|ClaimFollowUpPage|ClaimSubmissionPage|ClaimsWorkspacePage|ArWorkspacePage|Insurance A/R" artifacts/therassistant-inventory/src e2e
```

Expected: only intentional migration comments/tests/legacy redirect identifiers remain. No user-facing copy or imports of deleted pages remain.

Then:

```bash
pnpm typecheck
pnpm build
pnpm test:e2e -- e2e/rcm-workqueues.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/therassistant-inventory/src e2e/rcm-workqueues.spec.ts
git rm artifacts/therassistant-inventory/src/pages/work-center.tsx \
  artifacts/therassistant-inventory/src/domains/claims/ClaimSubmissionPage.tsx
git commit -m "refactor: remove duplicate revenue cycle workflows"
```

---

### Task 8: Full verification and duplicate-workflow guardrails

**Files:**
- Modify: `e2e/rcm-workqueues.spec.ts`
- Modify as required: `e2e/workspaces.spec.ts`
- No production changes unless verification exposes a defect.

**Interfaces:**
- Final acceptance test suite becomes the regression guard against reintroducing duplicate operational surfaces.

- [ ] **Step 1: Add final flow assertions**

Extend `e2e/rcm-workqueues.spec.ts` to verify these transitions with existing synthetic/demo controls or seeded records:

```text
Signed note -> charge appears in Charges
Charge -> claim -> successful validation -> Charges ready for batch
Validation failure -> Rejections
Clearinghouse rejection -> Rejections
Successful submission/acceptance with open balance -> Claims
Active denial/CARC -> Denials
Appeal -> Denials > Appeals
Deferred claim -> Claims > Deferred
Deferred denial -> Denials > Deferred
Paid/zero-balance claim -> absent from Claims and Denials; visible in payment history/context
```

Each transition test must assert the record is absent from its prior queue after the state change; this is the primary duplicate-workflow guard.

- [ ] **Step 2: Verify each Claims record receives at most one Claims tab**

Add a test helper that counts the selected claim control number across all Claims tabs for one payer and asserts `<= 1`.

- [ ] **Step 3: Verify each Denial receives at most one Denials tab**

Do the same across CARC/category tabs plus Corrected Claims, Appeals, Deferred.

- [ ] **Step 4: Run all contract, type, build, and E2E checks**

```bash
node --experimental-strip-types artifacts/therassistant-inventory/src/domains/rcm/queue-routing.contract.test.ts
pnpm typecheck
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 5: Inspect changed files for stale terminology**

```bash
rg -n "workspace|work center|claim follow-up|insurance a/r" \
  artifacts/therassistant-inventory/src/domains \
  artifacts/therassistant-inventory/src/components \
  artifacts/therassistant-inventory/src/navigation
```

Review every match. Internal legacy CSS names may remain only if they are not user-facing and renaming them would add risk without changing behavior; product copy/page names must use the approved model.

- [ ] **Step 6: Final commit**

```bash
git add e2e/rcm-workqueues.spec.ts e2e/workspaces.spec.ts
git commit -m "test: guard canonical RCM workqueue ownership"
```

---

## Final Acceptance Checklist

- [ ] Revenue Cycle navigation exposes exactly Charges, Rejections, Claims, Denials, Payments as operational areas.
- [ ] `/work-center` no longer renders a Work Center and redirects away.
- [ ] `/claims/follow-up`, `/claims/submission`, `/ar-denials`, and `/charges` do not render duplicate workflows.
- [ ] Charges receives work after signed-note charge creation and owns payer batching/submission.
- [ ] Charges can electronically submit, download 837P demo output, and print CMS-1500 output.
- [ ] Validation failures and clearinghouse rejections are corrected only in Rejections.
- [ ] Rejections groups by payer and unresolved correction category.
- [ ] Claims has one queue per payer and exactly the seven approved tabs.
- [ ] Claims does not contain validation, rejection, denial, appeal, or submission tabs/actions.
- [ ] Denials has one queue per payer, dynamic CARC/category tabs, and Corrected Claims/Appeals/Deferred.
- [ ] Appeals exist only as a Denials tab/disposition, not a top-level workflow.
- [ ] Authorization remains record/context data only; no authorization workqueue exists.
- [ ] Existing payment posting remains functional.
- [ ] Existing Claim 360/detail history remains available without becoming a second operational queue.
- [ ] Queue-classification tests prove mutually exclusive Claims and Denials tab ownership.
- [ ] `pnpm typecheck`, `pnpm build`, and full Playwright E2E pass.
