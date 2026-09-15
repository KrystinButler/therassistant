# Work Drawer + Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the reusable THERASSISTANT WorkDrawer and convert the Claims workspace into an in-context operational queue with editable claim work, educational error-to-field navigation, and Previous/Next/Save & Continue.

**Architecture:** `/claims` remains mounted and owns search/filter/queue/selection state. `WorkDrawer` wraps the existing Radix-backed `components/ui/sheet.tsx` primitive and owns only drawer mechanics. Claim-specific components reuse the existing claim API/demo mutations and the permanent `/claims/:id` route remains the Claim 360.

**Tech Stack:** React, TypeScript, Vite, Wouter, existing Radix Dialog-based Sheet, existing THERASSISTANT CSS/components, existing `useApi`, `demoUpdate`, and `demoInsert` data utilities.

**Spec:** `docs/superpowers/specs/2026-09-15-work-drawer-architecture-design.md`

## Global Constraints

- Do not add another UI library; use `artifacts/therassistant-inventory/src/components/ui/sheet.tsx`.
- Preserve `/claims` and `/claims/:id` routes and existing domain/business logic.
- Do not expose UUIDs when readable identifiers/names exist.
- Pre-submission `validation_failed` is not `Action Required`; that label is reserved for post-submission rejection responses.
- Closing a drawer must preserve search, status filter, queue ordering, and workspace position.
- Dirty forms require confirmation before discard.
- Run typecheck and production build after each independently testable phase.

---

## File structure

- Create `artifacts/therassistant-inventory/src/components/work-drawer.tsx` — generic shell, header/body/footer, queue navigation, dirty-close guard.
- Create `artifacts/therassistant-inventory/src/components/work-drawer.css` — responsive 700–850px desktop sizing, sticky regions, scroll body, action layout.
- Create `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.tsx` — claim orchestration and tabs/sections.
- Create `artifacts/therassistant-inventory/src/domains/claims/claim-field-editor.tsx` — focused editable claim fields and semantic field refs.
- Create `artifacts/therassistant-inventory/src/domains/claims/claim-errors.tsx` — educational validation/rejection presentation and correction actions.
- Create `artifacts/therassistant-inventory/src/domains/claims/claim-work-drawer.types.ts` — stable section and field-key contracts.
- Modify `artifacts/therassistant-inventory/src/pages/claims.tsx` — keep queue mounted; select/open claims rather than route-transitioning on ordinary row work.
- Modify `artifacts/therassistant-inventory/src/index.css` only if shared existing THERASSISTANT utility classes need small compatibility additions; prefer drawer-local CSS.

### Task 1: Reusable WorkDrawer shell

**Interfaces:**
- Produces `WorkDrawerProps` with `open`, `onOpenChange`, `title`, `subtitle`, `badges`, `children`, `footer`, `onPrevious`, `onNext`, `openFullRecord`, `queuePosition`, `dirty`, `confirmDiscard`, `previousDisabled`, and `nextDisabled`.
- Uses existing `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, and `SheetDescription`.

- [ ] **Step 1: Create the WorkDrawer contract and shell**

Implement a controlled component. Its close handler must use this decision:

```ts
function requestOpenChange(nextOpen: boolean) {
  if (!nextOpen && dirty && !confirmDiscard()) return;
  onOpenChange(nextOpen);
}
```

Default `confirmDiscard` to a small injectable function that calls `window.confirm("Discard unsaved changes?")`; do not use `window.prompt`. Keeping it injectable makes behavior testable and allows a later app-level confirmation dialog without changing consumers.

Render `SheetContent side="right"` with drawer-specific classes. Header contains title/subtitle, optional badges, queue position, Previous/Next controls, and Open Full Record. Body is a dedicated scrolling region. Footer is sticky and renders caller-provided actions.

- [ ] **Step 2: Add responsive drawer styling**

Desktop target:

```css
.thera-work-drawer {
  width: min(820px, 92vw);
  max-width: 850px !important;
  height: 100dvh;
  padding: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
```

Use sticky header/footer surfaces, body `overflow-y:auto`, existing border/background variables, and a mobile media query setting width/max-width to approximately 100vw. Do not restyle the global Sheet primitive.

- [ ] **Step 3: Verify shell behavior**

Run:

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

Expected: both exit 0.

Manual smoke: mount the shell temporarily or through the first Claim consumer; verify Escape/close works when clean, dirty close invokes confirmation, keyboard focus remains trapped by Radix, and the underlying page remains mounted.

- [ ] **Step 4: Commit**

```bash
git add artifacts/therassistant-inventory/src/components/work-drawer.tsx artifacts/therassistant-inventory/src/components/work-drawer.css
git commit -m "feat: add reusable work drawer shell"
```

### Task 2: Claim drawer context and section architecture

**Interfaces:**
- `ClaimWorkSection = "fields" | "lines" | "diagnoses" | "validation" | "responses" | "rejections" | "denials" | "appeals" | "work-items" | "history"`.
- `ClaimFieldKey` initially includes `patientControlNumber`, `payerClaimNumber`, `serviceDateFrom`, `renderingProvider`, `renderingProviderTaxonomy`, `billingProvider`, and other editable keys actually supported by current claim payloads.
- `ClaimWorkDrawer` consumes a selected `ClaimRow`, queue position/navigation callbacks, `onRefresh`, and `onClose`.

- [ ] **Step 1: Define stable claim work contracts**

Create `claim-work-drawer.types.ts` with semantic section/field keys. Do not encode DOM IDs in error records; map semantic keys to refs inside the field editor.

- [ ] **Step 2: Build ClaimWorkDrawer header and sections**

Header must show patient, claim/control number, payer, rendering provider, DOS, charge, and status using `StatusBadge`. Use readable fallbacks such as `No payer claim #`, never UUID display.

Render section controls for all required claim areas. Sections without data yet should show a concise empty state rather than inventing domain records.

- [ ] **Step 3: Preserve full-record access**

Pass an Open Full Claim 360 callback that navigates to `/claims/${claim.id}` only when the user explicitly chooses full-record review.

- [ ] **Step 4: Verify**

Run typecheck/build commands above. Manually confirm large-screen width, small-screen width, header/body/footer behavior, and readable header context.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims
git commit -m "feat: add claim work drawer structure"
```

### Task 3: Keep `/claims` mounted and open claims in context

**Interfaces:**
- ClaimsPage owns `selectedClaimId: string | null`.
- `selectedClaim` derives from current `data` without replacing `search` or `status` state.
- Current queue order is `(data ?? [])` exactly as returned for the active search/status request.

- [ ] **Step 1: Replace ordinary claim route transition with selection**

In `claims.tsx`, change the primary claim link/row work action to a button that calls `setSelectedClaimId(claim.id)`. Retain a separate explicit Open 360 action where appropriate.

- [ ] **Step 2: Render ClaimWorkDrawer beside the workspace markup**

Derive:

```ts
const claims = data ?? [];
const selectedIndex = claims.findIndex((claim) => claim.id === selectedClaimId);
const selectedClaim = selectedIndex >= 0 ? claims[selectedIndex] : null;
```

Pass queue position `${selectedIndex + 1} of ${claims.length}` and callbacks that only change `selectedClaimId`. Do not modify search/status when navigating.

- [ ] **Step 3: Protect workspace state**

Do not key/remount ClaimsPage when the selected claim changes. Closing sets only `selectedClaimId(null)`. Keep the filter controls controlled by their existing state.

- [ ] **Step 4: Verify**

Set a non-empty search and status filter, open a claim, move Next, close, and verify both filter values and displayed queue remain unchanged. Scroll the table before opening and confirm closing does not intentionally scroll the page to top.

Run typecheck/build.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/pages/claims.tsx
git commit -m "feat: open claim work from claims queue"
```

### Task 4: Editable claim fields and dirty state

**Interfaces:**
- `ClaimFieldEditor` receives `claim`, `onDirtyChange`, `registerFieldRef(fieldKey, element)`, and save callbacks.
- Persistence continues through existing claim update logic (`demoUpdate("professional_claims", claim.id, patch)` in the current demo implementation) rather than a duplicate drawer-only service.

- [ ] **Step 1: Build focused field editor**

Populate editable controls only for claim properties backed by current data/update behavior. Organize them into logical groups rather than one giant form. Maintain a local draft initialized from the selected claim.

- [ ] **Step 2: Track dirty state**

Dirty becomes true when draft values differ from the selected claim snapshot and false after successful save or when a newly selected queue record initializes.

- [ ] **Step 3: Register semantic field refs**

For each editable field, register its element by `ClaimFieldKey`. `renderingProviderTaxonomy` must be addressable when that field exists in the current claim model. If the API payload does not yet expose it, first reuse the existing claim-detail/API source rather than creating fake data.

- [ ] **Step 4: Implement Save**

Convert changed draft fields to the existing persistence field names, call existing update logic, await success, call `onRefresh`, and clear dirty state. Failed saves retain draft and dirty state.

- [ ] **Step 5: Verify**

Edit a supported field, attempt close and verify discard confirmation. Cancel discard and verify the drawer stays open. Save and verify close no longer warns. Reopen and verify saved value is returned by the existing API.

Run typecheck/build.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/pages/claims.tsx
git commit -m "feat: edit claim fields in work drawer"
```

### Task 5: Educational validation and rejection error-to-field navigation

**Interfaces:**
- `ClaimActionableError` contains `id`, `kind: "validation" | "rejection"`, `summary`, `whyItMatters`, `correction`, `actionLabel`, `targetSection`, and optional `targetField`.
- Correction handler signature: `(section: ClaimWorkSection, field?: ClaimFieldKey) => void`.

- [ ] **Step 1: Adapt existing claim validation/rejection data**

Read the existing Claim 360/API response sources and map real records into `ClaimActionableError`. Do not invent rejection codes or duplicate backend validation rules.

- [ ] **Step 2: Render the four-part teaching pattern**

Each actionable item visibly provides: what is wrong; why it matters; what needs correction; a direct action button.

- [ ] **Step 3: Enforce status terminology**

Validation section headings/badges for pre-submission failures use `Validation Failed` or equivalent. Only rejection records received after submission may display `Action Required`.

- [ ] **Step 4: Implement correction targeting**

On correction click: activate `targetSection`; after the section renders, scroll the registered `targetField` into view and focus it. Use `requestAnimationFrame` or an effect keyed by pending target; do not use arbitrary timeouts.

- [ ] **Step 5: Verify taxonomy scenario**

Using a real/synthetic record that contains a taxonomy validation/rejection issue, click Correct Taxonomy and verify Claim Fields activates and the taxonomy control receives focus. Verify a pre-submission validation failure never renders Action Required.

Run typecheck/build.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims
git commit -m "feat: guide claim corrections to editable fields"
```

### Task 6: Save & Revalidate and operational claim actions

**Interfaces:**
- Reuse existing `updateStatus`/domain persistence behavior; extract it from ClaimsPage only if needed to avoid duplication.
- Existing `createFollowUp` logic remains authoritative for workqueue creation.

- [ ] **Step 1: Add Save & Revalidate**

Save the draft first. On success, run the existing validation transition/action appropriate to the current demo/business implementation and refresh. Do not advance queue unless the user chose Save & Continue.

- [ ] **Step 2: Move contextual actions into drawer**

Expose Retry Rejected Claim, Create Follow-Up, and other already-supported status transitions only when valid for current status. Do not remove existing backend/state constraints.

- [ ] **Step 3: Keep destructive/irreversible actions separated**

Use footer/action grouping so submission/retry or future destructive actions are not visually adjacent to ordinary Save without separation.

- [ ] **Step 4: Verify**

Exercise `ready_for_validation`, `validation_failed`, `rejected`, and `denied` synthetic claims. Verify action visibility matches status and Create Follow-Up still inserts through existing workqueue logic.

Run typecheck/build.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/pages/claims.tsx
git commit -m "feat: add claim drawer operational actions"
```

### Task 7: Previous, Next, and Save & Continue

**Interfaces:**
- Queue navigation is index-based over the current `claims` array from ClaimsPage.
- `Save & Continue` returns a successful-save signal before changing selected ID.

- [ ] **Step 1: Wire Previous/Next**

Previous selects `claims[selectedIndex - 1].id`; Next selects `claims[selectedIndex + 1].id`. Disable at queue boundaries. If current form is dirty, changing records uses the same discard protection unless the transition follows a successful save.

- [ ] **Step 2: Implement Save & Continue**

Await save. If save fails, stay on current record. If successful and a next claim exists, select it. If successful at the end of the queue, remain on the current record and show a concise queue-complete state/message.

- [ ] **Step 3: Verify queue semantics**

Apply a status filter, open the second result, use Previous/Next and verify navigation never leaves the filtered result set. Edit and Save & Continue; verify the next filtered claim opens and filters remain unchanged.

Run typecheck/build.

- [ ] **Step 4: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/claims artifacts/therassistant-inventory/src/pages/claims.tsx
git commit -m "feat: add claim queue continuation workflow"
```

### Task 8: Phase-1 regression and responsive verification

- [ ] **Step 1: Run static verification**

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

Both must exit 0.

- [ ] **Step 2: Run repository tests relevant to the inventory frontend**

Use the repository's existing test commands if present. Do not introduce a new test framework solely for this phase. If no frontend test script exists, record that fact in the PR and rely on typecheck/build plus route/browser smoke verification.

- [ ] **Step 3: Route smoke verification**

Verify `/claims` loads, `/claims/:id` still loads as Claim 360, and existing Revenue Cycle navigation still resolves. Confirm ordinary claim selection does not change the `/claims` route.

- [ ] **Step 4: Interaction verification**

Verify clean close, dirty-close confirmation, exact search/status persistence, queue Previous/Next, Save & Continue, Open Full Claim 360, keyboard tab/focus behavior, and no visible internal UUIDs in new drawer UI.

- [ ] **Step 5: Responsive verification**

Check desktop width around 820px and viewport widths near tablet/mobile. Drawer must become full/nearly-full width without horizontal form overflow; header/footer remain usable and body independently scrolls.

- [ ] **Step 6: Commit regression fixes only if needed**

```bash
git add artifacts/therassistant-inventory
git commit -m "fix: harden claim work drawer interactions"
```

## Follow-on plans

After this phase is working and verified, create separate implementation plans for: (1) A/R denial and appeal drawers, (2) payment entry/detail/reversal drawers, (3) Patient/Provider/Schedule/Credentialing conversions, and (4) Mailroom. Each is independently testable and should not be bundled into this Claims implementation cycle.
