# Operational Workspaces Phase 2 Implementation Plan

**Goal:** Make the remaining THERASSISTANT operational workspaces actionable and consistent with the production WorkDrawer architecture while preserving routes and business logic.

**Architecture:** Reuse the existing WorkDrawer and repository/domain actions. Workspace pages retain filters, tabs, queue state, and human-readable context. Operational edits/actions open in right-side drawers; permanent detail routes remain available. Replace browser prompts and centered modals encountered in scope. Do not duplicate business logic.

**Tech Stack:** React, TypeScript, Wouter, existing THERASSISTANT UI components, existing Supabase/demo repositories, Vitest/contract tests, Vercel.

---

### Task 1: Charge Capture / Billing queue
- Inspect `src/domains/billing/BillingQueuePage.tsx`, `src/domains/billing/repository.ts`, and existing charge tables/actions.
- Add failing contract tests for drawer-based charge work, structured blocking, queue preservation, and human-readable display.
- Implement Charge Work Drawer using existing WorkDrawer.
- Move operational audit/correction/block/create-charge/create-claim actions into contextual drawer where appropriate; remove any prompt-based blocking encountered.
- Preserve `/charges`, `/billing/charges`, and encounter routes.
- Run focused tests, typecheck, build, and route smoke checks.

### Task 2: Eligibility workspace
- Inspect `src/domains/payer-readiness/EligibilityPage.tsx`, payer-readiness repository, and eligibility repository.
- Add tests for eligibility detail/work drawer, rerun action, patient/payer/member context, and attention queue state.
- Implement contextual Eligibility Work Drawer and retain Patient Chart deep link.
- Ensure no internal IDs are rendered when names/member identifiers exist.
- Run focused tests, typecheck, build, and route smoke checks.

### Task 3: Payers & Contracts
- Inspect `src/domains/credentialing/PayersContractsPage.tsx` and payer detail APIs/routes.
- Add tests requiring contract creation/editing in WorkDrawer rather than centered overlay.
- Convert `+ Contract` to WorkDrawer and add payer context/full payer record action.
- Preserve `/payers-contracts` and `/payers/:id`.
- Run focused tests, typecheck, build, and route smoke checks.

### Task 4: Reports
- Inspect `src/pages/operational-workspaces.tsx`, `/api/reports`, and report data shapes.
- Add tests for curated report presentation that excludes UUID/internal-key columns and provides useful labels/metrics.
- Replace generic raw-object rendering for Reports with a purpose-built operational reports workspace using existing report API data.
- Preserve `/reports`.
- Run focused tests, typecheck, build, and route smoke checks.

### Task 5: Administration / Imports
- Inspect `src/pages/restored-modules.tsx`, `src/pages/administration.tsx`, and `/api/imports` implementation.
- Add tests for human-readable import validation rows, actionable error state, and Administration navigation to Imports.
- Replace generic Imports rendering with a purpose-built import-validation workspace; add Imports to Administration as an available tool.
- Use WorkDrawer for import record/error review where operational action is needed.
- Preserve `/administration/imports` and `/administration`.
- Run focused tests, typecheck, build, and route smoke checks.

### Task 6: Cross-module verification and integration
- Search scoped modules for `window.prompt`, centered modal implementations, UUID rendering, dead buttons, and route regressions; fix issues within approved scope.
- Run all tests, TypeScript/typecheck, production build, security/contract checks, and route smoke tests.
- Create PR, review diff/checks, fix review findings, merge only when clean.
- Verify production Vercel deployment reaches READY and affected production routes load.
