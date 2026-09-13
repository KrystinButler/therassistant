# Phase 3 Advanced Billing + A/R Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Therassistant’s advanced billing and revenue-recovery workflows: Billing routing, claims workqueues, aging, denials/appeals, full payment operations, recoupments/refunds, and underpayment variance.

**Architecture:** Extend the existing Phase 1/2 React/Vite + Supabase domains rather than replacing them. New billing/A/R behavior lives in focused domain modules with pure workflow functions covered by Node tests; repositories adapt those functions to current Supabase tables. Existing accounting tables remain canonical, linked Work Center items provide operational assignment/history, and schema changes are additive only where the current model lacks a real field.

**Tech Stack:** React, TypeScript, Vite, Wouter, Supabase/PostgREST, Node `tsx --test`, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-13-therassistant-canonical-ehr-rcm-design.md`

## Global Constraints

- Keep React/Vite + Supabase + GitHub + Vercel; do not reintroduce Replit.
- Synthetic demo data only; no PHI.
- Preserve current Supabase tables and add only necessary schema fields.
- No user-facing raw UUID-first/table-dump workflows.
- Every state transition must persist before the UI reports success.
- Financial posting must preserve allocation/reversal history; never silently overwrite posted accounting history.
- Exceptions must create or update linked Work Center items rather than becoming dead-end statuses.
- Credentialing/contracting denials are configurable non-workable/write-off policy cases and are not forced through appeals.
- Phase 3 feature branch disables automatic Vercel deployments; GitHub CI is the primary development gate.
- One reviewed commit per task to minimize deployment churn.

---

### Task 1: Billing Routing Hub

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/billing/hub.ts`
- Create: `artifacts/therassistant-inventory/src/domains/billing/BillingHubPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Test: `artifacts/therassistant-inventory/tests/billing-hub.test.ts`

**Interfaces:**
- Produces `buildBillingHubSummary(input): BillingHubSummary`.
- `BillingHubSummary` exposes counts/amounts for charge readiness, claims needing action, payment exceptions, insurance A/R, patient A/R, denials, appeals, underpayments, and refunds/recoupments.
- `/billing` becomes the routing hub; `/billing/charges` preserves the existing readiness queue.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildBillingHubSummary } from "../src/domains/billing/hub";

test("billing hub summarizes actionable financial work", () => {
  const summary = buildBillingHubSummary({
    charges: [{ charge_status: "ready_for_claim", charge_amount_cents: 12000 }],
    claims: [{ claim_status: "rejected", total_charge_cents: 12000 }],
    payments: [{ payment_status: "unapplied", amount_cents: 8000 }],
    denials: [{ denial_status: "new", amount_cents: 12000 }],
    appeals: [{ appeal_status: "drafting" }],
    insuranceAr: [{ openBalanceCents: 12000 }],
    patientAr: [{ openBalanceCents: 2500 }],
    variances: [{ varianceCents: 1500 }],
    recoveryItems: [{ amount_cents: 3000 }],
  });
  assert.equal(summary.readyCharges.count, 1);
  assert.equal(summary.claimsNeedAction.count, 1);
  assert.equal(summary.unappliedPayments.amountCents, 8000);
  assert.equal(summary.insuranceAr.amountCents, 12000);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/billing-hub.test.ts`
Expected: FAIL because `billing/hub.ts` does not exist.

- [ ] **Step 3: Implement hub summary and page**

The hub page links to `/billing/charges`, `/claims`, `/payments`, `/ar-denials?tab=insurance`, `/ar-denials?tab=patient`, `/ar-denials?tab=denials`, `/ar-denials?tab=appeals`, `/ar-denials?tab=variance`, and `/ar-denials?tab=recovery`.

- [ ] **Step 4: Run test + Phase 2 regression suite**

Run: `pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add Phase 3 billing routing hub`

---

### Task 2: Full Claims Workspace and Rejection Workqueues

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/claims/workqueues.ts`
- Create: `artifacts/therassistant-inventory/src/domains/claims/ClaimsWorkspacePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/claims/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Test: `artifacts/therassistant-inventory/tests/claims-workqueues.test.ts`

**Interfaces:**
- Produces `buildClaimWorkqueues(claims, responses, denials, payments)`.
- Produces safe bulk functions for `validate`, `create follow-up`, and `retry rejected` only; bulk direct payment/denial resolution is not allowed.
- Workspace tabs: Overview, Claims List, Workqueues, Rejections, Denials, Appeals, Reports.

- [ ] **Step 1: Write failing tests for queue classification and bulk safety**

```ts
test("rejected claims are isolated in rejection workqueue", () => {
  const result = buildClaimWorkqueues([{ id: "c1", claim_status: "rejected" }], [], [], []);
  assert.deepEqual(result.rejections.map((row) => row.id), ["c1"]);
});

test("bulk action rejects unsafe financial transitions", () => {
  assert.equal(canBulkClaimAction("mark_paid"), false);
  assert.equal(canBulkClaimAction("validate"), true);
});
```

- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement filters/search/sort/page/bulk selection and rejection correction routing**
- [ ] **Step 4: Verify tests and strict typecheck**
- [ ] **Step 5: Commit** `feat: add claims workspace and rejection queues`

---

### Task 3: Insurance and Patient A/R Aging

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/aging.ts`
- Create: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Test: `artifacts/therassistant-inventory/tests/ar-aging.test.ts`

**Interfaces:**
- Produces `agingBucket(serviceDate, asOfDate)` returning `0-30 | 31-60 | 61-90 | 91-120 | 120+`.
- Produces `buildInsuranceArRows(...)` and `buildPatientArRows(...)` with patient/payer/provider names, DOS, claim number, status, original charge, paid, adjustments, open balance, days outstanding, bucket, denial/work status.
- Patient A/R is based on explicit patient-responsibility state/ERA PR adjustments and patient payments; it does not infer collections activity.

- [ ] **Step 1: Write boundary tests for every aging bucket and balance calculation**

```ts
assert.equal(agingBucket("2026-09-01", "2026-09-13"), "0-30");
assert.equal(agingBucket("2026-08-01", "2026-09-13"), "31-60");
assert.equal(agingBucket("2026-06-01", "2026-09-13"), "91-120");
```

- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement repository aggregation and A/R tabs with payer/provider/status/bucket filters**
- [ ] **Step 4: Verify regression suite**
- [ ] **Step 5: Commit** `feat: add insurance and patient ar aging`

---

### Task 4: Denial and Appeal Lifecycle

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/denials.ts`
- Create: `supabase/migrations/20260913_phase3_denial_deadline.sql`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- Test: `artifacts/therassistant-inventory/tests/denials-appeals.test.ts`

**Interfaces:**
- Adds nullable `denials.timely_filing_deadline date`.
- Produces `classifyDenialPolicy(category)` returning `workable | auto_writeoff | needs_review`.
- Produces `createAppealInput(denial, level, deadline, notes)` and blocks duplicate active appeals.
- Credentialing/contracting categories default to `auto_writeoff` in the synthetic demo policy; they create adjustment/work history rather than an appeal.

- [ ] **Step 1: Write failing tests**

```ts
assert.equal(classifyDenialPolicy("credentialing"), "auto_writeoff");
assert.equal(classifyDenialPolicy("authorization"), "workable");
assert.throws(() => assertAppealAllowed({ category: "contracting", hasActiveAppeal: false }));
assert.throws(() => assertAppealAllowed({ category: "authorization", hasActiveAppeal: true }));
```

- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Apply additive migration and demo RLS grant if needed**
- [ ] **Step 4: Implement Start Work, create appeal, submit appeal, record outcome, write-off policy path, due-date alerts, Work Center history**
- [ ] **Step 5: Verify tests and database constraints**
- [ ] **Step 6: Commit** `feat: complete denial and appeal lifecycle`

---

### Task 5: Full Payment Operations

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/payments/operations.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/payments/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/payments/PaymentsPage.tsx`
- Test: `artifacts/therassistant-inventory/tests/payment-operations.test.ts`

**Interfaces:**
- Produces `validatePaymentDraft`, `calculateUnapplied`, `buildAllocationPlan`, `buildPaymentReversal`.
- Manual insurance and patient payment entry persists payment first, then allocations, then derives `posted | partially_applied | unapplied`.
- Reversal inserts `payment_reversals`, marks affected allocations reversed, and changes payment status to `reversed`; history is preserved.
- Refund records use `payment_source = refund` and/or `adjustment_type = refund_correction`; posted payments are never deleted.

- [ ] **Step 1: Write failing accounting-integrity tests**

```ts
assert.equal(calculateUnapplied(10000, [6000, 2500]), 1500);
assert.throws(() => buildAllocationPlan(10000, [7000, 4000]));
assert.equal(buildPaymentReversal({ paymentId: "p1", reason: "Duplicate" }).paymentStatus, "reversed");
```

- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement Insurance Payments, Patient Payments, ERA/835, Unapplied, Adjustments/Reversals tabs**
- [ ] **Step 4: Verify regression suite**
- [ ] **Step 5: Commit** `feat: complete payment allocation and reversal workflows`

---

### Task 6: Underpayment Variance, Recoupments, and Refunds

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/ar/variance.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/ar/ArWorkspacePage.tsx`
- Test: `artifacts/therassistant-inventory/tests/variance-recovery.test.ts`

**Interfaces:**
- Produces `expectedAllowedForLine(line, feeScheduleLines)` and `calculateContractVariance(expected, actual)`.
- Positive variance means payer underpayment and creates/updates a `contract_variance` Work Center item linked to the claim.
- Recovery tab filters `adjustments.adjustment_type in (recoupment, refund_correction)` and linked `refund_review/overpayment_review/credit_balance_review` work.

- [ ] **Step 1: Write failing variance/recovery tests**

```ts
assert.equal(calculateContractVariance(10000, 8500), 1500);
assert.equal(calculateContractVariance(10000, 10000), 0);
assert.equal(isRecoveryAdjustment("recoupment"), true);
```

- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement variance lookup and recovery workspace**
- [ ] **Step 4: Verify tests**
- [ ] **Step 5: Commit** `feat: add underpayment and recovery workflows`

---

### Task 7: Connected Phase 3 Demo Scenarios

**Files:**
- Create: `supabase/seed/20260913_phase3_advanced_billing_demo.sql`
- Create: `artifacts/therassistant-inventory/src/demo/phase3-scenarios.ts`
- Test: `artifacts/therassistant-inventory/tests/phase3-scenarios.test.ts`

**Interfaces:**
- Deterministic scenarios: clean insurance A/R, patient responsibility, claim rejection, workable denial + appeal, credentialing auto-writeoff denial, unapplied payment, payment reversal, underpayment variance, recoupment/refund review.
- Stable synthetic IDs; seed is idempotent and does not overwrite Phase 1/2 scenario intent.

- [ ] **Step 1: Write failing scenario catalog test**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Add seed and scenario catalog**
- [ ] **Step 4: Apply seed to Supabase and verify linked balances/statuses**
- [ ] **Step 5: Commit** `feat: seed Phase 3 billing recovery scenarios`

---

### Task 8: Phase 3 Release Gate

**Files:**
- Create: `artifacts/therassistant-inventory/tsconfig.phase3.json`
- Modify: `artifacts/therassistant-inventory/package.json`
- Create or Modify: `.github/workflows/phase3-ci.yml`
- Modify: `vercel.json` before merge so `main` uses `typecheck:phase3`; keep the feature-branch deployment disable rule harmlessly scoped to the branch.

**Interfaces:**
- CI sequence: frozen install → all tests → Phase 3 strict typecheck → Vite build → local SPA route smoke.
- Smoke routes: `/billing`, `/billing/charges`, `/claims`, `/payments`, `/ar-denials`, representative Claim 360 and Patient Chart routes.

- [ ] **Step 1: Add Phase 3 strict config covering all Phase 1–3 domains and routed pages**
- [ ] **Step 2: Run full suite**

Run:
`pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts`

- [ ] **Step 3: Run strict Phase 3 typecheck**

Run:
`pnpm --filter @workspace/therassistant-inventory run typecheck:phase3`

- [ ] **Step 4: Build**

Run:
`pnpm --filter @workspace/therassistant-inventory run build`

- [ ] **Step 5: Smoke built SPA routes in GitHub CI**
- [ ] **Step 6: Verify Supabase demo privileges have no DELETE/TRUNCATE grants beyond explicitly required accounting reversals**
- [ ] **Step 7: Review branch diff and create merge PR only when every gate is green**
- [ ] **Step 8: After merge, allow one clean production deployment or promote a verified READY deployment; do not create repeated Vercel builds**

---

## Self-Review

- Phase 3 spec coverage: Billing hub, claim tabs/workqueues/bulk actions/rejections, insurance/patient aging, denials/appeals, recoupments/refunds, underpayment variance, and full payment/ERA workspaces are each assigned to a task.
- No duplicate financial storage is introduced; current claims/payment/adjustment/ERA/workqueue tables remain canonical.
- The only planned schema addition is `denials.timely_filing_deadline`, because the current denial table lacks a durable timely-filing field.
- Financial transitions preserve history and forbid delete-based accounting corrections.
- Function/type names used by later tasks are defined by earlier task interfaces.
- No TODO/TBD placeholders remain.
