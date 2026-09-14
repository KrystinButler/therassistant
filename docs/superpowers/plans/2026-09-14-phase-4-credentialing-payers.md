# Phase 4 Credentialing + Payers Implementation Plan

**Goal:** Convert the existing credentialing and payer data into connected Provider 360, credentialing workqueue, revalidation, Payer 360, contract, and fee-schedule workflows.

**Architecture:** Reuse existing Supabase tables and workflow infrastructure. Add only `provider_payer_enrollments.revalidation_due_date`. Put reusable credentialing rules/workflows under `artifacts/therassistant-inventory/src/domains/credentialing`, extend Provider 360 and create Payer 360, and keep UI writes routed through existing demo data helpers or API routes as appropriate.

**Tech Stack:** React, TypeScript, Vite, Wouter, Node test runner, Express API, Supabase/Postgres, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-14-phase-4-credentialing-payers.md`

## Task 1: Credentialing lifecycle behavior

**Files:**
- Create: `artifacts/therassistant-inventory/tests/credentialing-workflow.test.ts`
- Create: `artifacts/therassistant-inventory/src/domains/credentialing/workflow.ts`

1. Add failing tests for contextual enrollment actions, revalidation due/overdue classification, status-history payloads, and credentialing work-item payloads.
2. Run Phase 4 tests and confirm RED because workflow module/behavior is missing.
3. Implement pure workflow helpers with no database coupling.
4. Run tests and confirm GREEN.

## Task 2: Supabase revalidation field and write access

**Files:**
- Create: `supabase/migrations/20260914_phase4_credentialing_revalidation.sql`

1. Inspect existing RLS/write policies for provider identifiers, provider-payer enrollments, payer contracts, fee schedules, fee schedule lines, payer plans, status history, and workqueue items.
2. Add `revalidation_due_date date` to `provider_payer_enrollments` and required indexes/write policies only where current Phase 4 UI cannot operate.
3. Apply to Supabase project and verify the column exists.
4. Run Supabase security and performance advisors; resolve new findings attributable to Phase 4.

## Task 3: Provider 360 credentialing data

**Files:**
- Modify: `artifacts/api-server/src/routes/providers.ts`
- Modify: `artifacts/therassistant-inventory/src/pages/provider-detail.tsx`
- Modify/create tests under `artifacts/therassistant-inventory/tests/`

1. Add failing tests for Provider 360 credentialing presentation/model behavior.
2. Extend provider detail API response with identifiers, payer enrollments with payer names, and credentialing work/history as needed.
3. Add Provider 360 sections for identifiers, payer enrollments, revalidation, and credentialing issues; resolve names rather than UUID labels.
4. Add identifier and enrollment editing actions using established write helpers.
5. Verify tests and TypeScript.

## Task 4: Actionable Credentialing workspace

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/credentialing/CredentialingPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/operational-workspaces.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx` if imports are moved

1. Add failing behavioral tests for permitted actions and revalidation warning behavior.
2. Replace bare status dropdown with explicit contextual actions and edit form.
3. On status transitions, update enrollment, insert `status_history`, and create/complete credentialing work items when appropriate.
4. Show provider/payer names, effective/revalidation/termination dates, payer provider ID, notes, due state, and actionable buttons.
5. Verify tests and TypeScript.

## Task 5: Payer 360, plans, contracts, fee schedules

**Files:**
- Create: `artifacts/therassistant-inventory/src/pages/payer-detail.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/operational-workspaces.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Add tests under `artifacts/therassistant-inventory/tests/`

1. Add failing tests for payer detail aggregation/rate display helpers.
2. Make `/payers-contracts` a payer management list with payer links and contract summary.
3. Add `/payers/:id` Payer 360 showing payer metadata, plans, contracts, enrolled providers, fee schedules, and CPT/modifier rates.
4. Add actions to create plans, contracts, fee schedules, and fee schedule lines; edit contract lifecycle fields.
5. Ensure all linked entities use human-readable names.
6. Verify tests and TypeScript.

## Task 6: Billing-readiness revalidation behavior

**Files:**
- Modify: `artifacts/therassistant-inventory/tests/billing-workflow.test.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/readiness/evaluate-billing-readiness.ts` only if required

1. Add a failing test defining the desired treatment of `needs_revalidation` as operational warning/task while preserving credentialing visibility.
2. Implement the smallest compatible readiness change without weakening blocking participation rules.
3. Run billing and credentialing tests.

## Task 7: Phase 4 CI and route coverage

**Files:**
- Create: `artifacts/therassistant-inventory/tsconfig.phase4.json`
- Create: `.github/workflows/phase4-ci.yml`
- Modify: `artifacts/therassistant-inventory/package.json`

1. Add Phase 4 typecheck script.
2. Run all existing Node tests plus Phase 4 tests.
3. Run Phase 4 TypeScript check, browser secret scan, and Vite build.
4. Smoke `/providers`, `/providers/<id>`, `/credentialing`, `/payers-contracts`, and `/payers/<id>`.

## Task 8: Final verification and preview

1. Confirm GitHub CI is green on `phase-4-credentialing-payers`.
2. Confirm Vercel preview is READY.
3. Smoke the Phase 4 routes on preview and check Vercel runtime/build logs for fatal errors.
4. Run Supabase advisors again after final schema/policy changes.
5. Review branch diff against `main` and create a pull request only after all gates pass.