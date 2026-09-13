# Therassistant Phase 1 Workflow Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one complete, demonstrable Therassistant workflow from patient insurance and eligibility through appointment, encounter, signed documentation, billing readiness, claim/837P, payer response, payment or denial, and Work Center follow-up.

**Architecture:** Keep the current React/Vite application, Supabase project, GitHub repository, and Vercel deployment. Add focused domain modules under `src/domains/*`, use a small repository abstraction over the existing browser-safe Supabase REST access, add first-class Encounter tables in Supabase, and route existing screens to domain-specific pages instead of the generic table renderer. Preserve existing working tables and map domain concepts to them rather than renaming the database wholesale.

**Tech Stack:** React 19.1, Vite 7.3, TypeScript 5.9, Wouter 3.3, Supabase Postgres/PostgREST, pnpm workspace, `tsx` + Node `node:test`, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-13-therassistant-canonical-ehr-rcm-design.md`

## Global Constraints

- Synthetic demo data only during this phase; no PHI.
- Browser code may use only the Supabase publishable key; never expose service-role credentials.
- Keep the current demo-tenant RLS isolation.
- Do not make workqueues the primary operating screen for normal scheduling, clinical, billing, or claims work.
- Do not expose UUIDs as primary user-facing identifiers.
- Appointments remain the scheduling source; encounters become the clinical and billing source of truth after service begins.
- Signing documentation triggers readiness evaluation; it does not automatically submit a claim.
- Claims may not become `submitted` without a real `claim_submissions` record and batch/submission workflow.
- Payment posting requires allocations or an explicit unapplied remainder.
- Every blocking failure must state why the record is blocked and what action resolves it.
- Use current enum values already present in Supabase; do not invent incompatible statuses.
- Work in an isolated Git branch/worktree during execution and merge to `main` only after verification.

---

## File Structure Locked for Phase 1

### Database / seed
- Create `supabase/migrations/20260913_phase1_workflow_spine.sql` — encounter schema, source links, indexes, demo RLS/grants.
- Create `supabase/seed/20260913_phase1_workflow_spine_demo.sql` — complete synthetic happy-path and exception-path scenarios.

### Shared frontend infrastructure
- Modify `artifacts/therassistant-inventory/package.json` — add `tsx` and test scripts.
- Create `artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts` — typed REST client with select/insert/update helpers and demo tenant lookup.
- Create `artifacts/therassistant-inventory/src/domains/shared/types.ts`.
- Create `artifacts/therassistant-inventory/src/domains/shared/workflow-result.ts`.

### Phase 1 domain modules
- Create `src/domains/readiness/types.ts`
- Create `src/domains/readiness/evaluate-pre-session.ts`
- Create `src/domains/readiness/evaluate-billing-readiness.ts`
- Create `src/domains/scheduling/repository.ts`
- Create `src/domains/scheduling/workflow.ts`
- Create `src/domains/scheduling/SchedulePage.tsx`
- Create `src/domains/scheduling/PreSessionPage.tsx`
- Create `src/domains/encounters/repository.ts`
- Create `src/domains/encounters/workflow.ts`
- Create `src/domains/encounters/EncounterPage.tsx`
- Create `src/domains/clinical/repository.ts`
- Create `src/domains/clinical/workflow.ts`
- Create `src/domains/billing/repository.ts`
- Create `src/domains/billing/workflow.ts`
- Create `src/domains/billing/BillingQueuePage.tsx`
- Create `src/domains/claims/repository.ts`
- Create `src/domains/claims/workflow.ts`
- Create `src/domains/claims/ClaimSubmissionPage.tsx`
- Create `src/domains/payments/repository.ts`
- Create `src/domains/payments/workflow.ts`
- Create `src/domains/payments/PaymentsPage.tsx`
- Create `src/domains/work-center/workflow.ts`
- Modify `src/pages/work-center.tsx`
- Modify `src/pages/client-detail.tsx`
- Modify `src/pages/claims.tsx`
- Modify `src/pages/claim-detail.tsx`
- Modify `src/pages/dashboard.tsx`
- Modify `src/components/app-shell.tsx`
- Modify `src/App.tsx`

### Tests
- Create `artifacts/therassistant-inventory/tests/readiness.test.ts`
- Create `artifacts/therassistant-inventory/tests/scheduling-workflow.test.ts`
- Create `artifacts/therassistant-inventory/tests/encounter-workflow.test.ts`
- Create `artifacts/therassistant-inventory/tests/billing-workflow.test.ts`
- Create `artifacts/therassistant-inventory/tests/claim-workflow.test.ts`
- Create `artifacts/therassistant-inventory/tests/payment-workflow.test.ts`
- Create `artifacts/therassistant-inventory/tests/work-center.test.ts`

---

### Task 1: Test Harness and Typed Supabase Client

**Files:** `artifacts/therassistant-inventory/package.json`, `src/lib/supabase-demo-client.ts`, `src/domains/shared/*`, `tests/supabase-demo-client.test.ts`

**Produces:** `demoSelect<T>()`, `demoInsert<T>()`, `demoUpdate<T>()`, `referenceSelect<T>()`, and `WorkflowResult<T>`.

- [ ] Add scripts `"test": "tsx --test tests/**/*.test.ts"` and `"test:workflow": "tsx --test tests/*workflow.test.ts"`, plus dev dependency `"tsx": "catalog:"`.
- [ ] Write the failing test:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildFilterQuery } from "../src/lib/supabase-demo-client.ts";

test("buildFilterQuery encodes PostgREST filters", () => {
  assert.equal(buildFilterQuery({ client_id: "eq.abc", limit: "1" }), "client_id=eq.abc&limit=1");
});
```

- [ ] Run `pnpm --filter @workspace/therassistant-inventory test`; expect failure because the helper is missing.
- [ ] Implement a fetch-injectable client:

```ts
export type FetchLike = typeof fetch;
export function buildFilterQuery(filters: Record<string,string> = {}) {
  return new URLSearchParams(filters).toString();
}
export function createDemoClient(fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
  return {
    async select<T>(table: string, filters: Record<string,string> = {}): Promise<T[]> { /* GET */ },
    async insert<T>(table: string, values: Record<string,unknown>): Promise<T> { /* tenant POST */ },
    async update<T>(table: string, id: string, values: Record<string,unknown>): Promise<T> { /* PATCH */ },
  };
}
```

- [ ] Add:

```ts
export type WorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; blocked: boolean; code: string; message: string; details?: string[] };
```

- [ ] Run test and typecheck; commit `test: add workflow test harness and Supabase client`.

---

### Task 2: First-Class Encounter Schema

**Files:** Create `supabase/migrations/20260913_phase1_workflow_spine.sql`.

**Produces:** `encounters`, `encounter_diagnoses`, `encounter_service_lines`, `encounter_readiness_checks`; adds `encounter_id` to notes/charges and `source_encounter_id` to claims.

- [ ] Write defensive DDL. Core encounter table:

```sql
create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_id uuid unique references public.appointments(id),
  client_id uuid not null references public.clients(id),
  provider_id uuid references public.providers(id),
  insurance_policy_id uuid references public.client_insurance_policies(id),
  payer_id uuid references public.payers(id),
  encounter_status text not null default 'in_progress' check (encounter_status in ('in_progress','completed','ready_for_billing','billing_hold','closed','voided')),
  billing_status text not null default 'not_ready' check (billing_status in ('not_ready','ready','held','charged','claimed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  location_type text,
  service_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] Add `encounter_diagnoses` with diagnosis code/description/primary/sequence/present-on-claim.
- [ ] Add `encounter_service_lines` with CPT/HCPCS, modifiers, units, charge cents, POS, ready-for-claim.
- [ ] Add `encounter_readiness_checks` with check code, pass/warn/fail result, blocking flag, message and action.
- [ ] Add source columns:

```sql
alter table public.clinical_notes add column if not exists encounter_id uuid references public.encounters(id);
alter table public.charge_capture_items add column if not exists encounter_id uuid references public.encounters(id);
alter table public.professional_claims add column if not exists source_encounter_id uuid references public.encounters(id);
```

- [ ] Add tenant/client/appointment/encounter indexes.
- [ ] Enable RLS and grant anon SELECT/INSERT/UPDATE only for rows in the `Therassistant Demo` tenant; no DELETE.
- [ ] Apply the exact checked-in migration to Supabase and verify the four tables plus three new columns exist.
- [ ] Commit `feat: add encounter workflow schema`.

---

### Task 3: Pre-Session Readiness Rules

**Files:** `src/domains/readiness/types.ts`, `evaluate-pre-session.ts`, `tests/readiness.test.ts`.

- [ ] Write failing tests for inactive eligibility, missing authorization, and approved ready service:

```ts
test("inactive coverage blocks the appointment", () => {
  const result = evaluatePreSession({
    policy: { status: "active" },
    eligibility: { eligibility_status: "inactive" },
    authorizationRequired: false,
    authorization: null,
    providerEnrollmentStatus: "approved",
  });
  assert.equal(result.ready, false);
});
```

- [ ] Implement:

```ts
export type ReadinessCheck = {
  code: string;
  label: string;
  status: "pass" | "warn" | "fail";
  blocking: boolean;
  message: string;
  action?: string;
};
export type PreSessionReadiness = { ready: boolean; checks: ReadinessCheck[] };
```

- [ ] Rules: missing policy blocks; eligibility inactive/ineligible/terminated/unable/error blocks; pending blocks until checked; required authorization missing/not-approved/expired/exhausted blocks; provider enrollment not approved blocks.
- [ ] Run tests; commit `feat: add pre-session readiness evaluation`.

---

### Task 4: Scheduling and Pre-Session Workflow

**Files:** `src/domains/scheduling/repository.ts`, `workflow.ts`, `SchedulePage.tsx`, `PreSessionPage.tsx`, `src/App.tsx`, `tests/scheduling-workflow.test.ts`.

**Produces:** `getSchedule()`, `getPreSession()`, `createAppointment()`, `runEligibility()`, `startEncounter()`.

- [ ] Test that appointment creation uses patient/provider selection and derives payer context rather than accepting raw UUID text fields.
- [ ] Repository joins appointments, patients, providers, policies, payers, eligibility checks, authorizations, and provider enrollments.
- [ ] Schedule UI supports Day/Week/Month, provider/status filters, New Appointment, Confirm, Check In, No Show, Cancel, Pre-Session, Start Encounter.
- [ ] Pre-Session displays patient, provider, payer/plan/member ID, eligibility, authorization/remaining units, provider enrollment, registration, readiness checks, and concrete corrective links/actions.
- [ ] Start Encounter button is disabled while any blocking readiness check exists.
- [ ] Route `/schedule` and `/schedule/:id` to the new domain pages, leaving old generic exports until verification.
- [ ] Run tests/build; commit `feat: rebuild scheduling and pre-session workflow`.

---

### Task 5: Encounter and Clinical Documentation

**Files:** `src/domains/encounters/*`, `src/domains/clinical/*`, `src/pages/client-detail.tsx`, `src/App.tsx`, `tests/encounter-workflow.test.ts`.

**Produces:** `startEncounter()`, `saveClinicalNote()`, `saveDiagnosis()`, `saveServiceLine()`, `signNote()`.

- [ ] Write idempotency test: starting the same appointment twice returns the same encounter.
- [ ] `startEncounter` rejects cancelled/no-show/rescheduled appointments, refuses blocking readiness, creates/returns one encounter, sets appointment `in_session`, and copies patient/provider/payer/policy/location/service context.
- [ ] Encounter workspace sections: header/status, insurance/readiness, SOAP/session note, diagnoses, service lines, treatment plan/goals, Sign Note, Route to Biller, readiness panel.
- [ ] `signNote` requires note text, at least one diagnosis, at least one service line, and signer identity; inserts `clinical_note_signatures`, sets note `signed`, sets `locked_at`, then runs billing readiness. It never submits a claim.
- [ ] Add patient-chart Encounter tab as the primary clinical/billing workflow path.
- [ ] Add `/encounters/:id` route.
- [ ] Run tests/build; commit `feat: add encounter and documentation workflow`.

---

### Task 6: Billing Readiness and Charge Workflow

**Files:** `src/domains/readiness/evaluate-billing-readiness.ts`, `src/domains/billing/*`, `tests/billing-workflow.test.ts`.

**Produces:** `evaluateBillingReadiness()`, `routeEncounterToBilling()`, `createChargeFromEncounter()`, `scrubCharge()`.

- [ ] Write tests for unsigned note, missing diagnosis, missing service line, authorization failure, credentialing failure, and clean readiness.
- [ ] Readiness requires signed note, diagnosis, service line, valid coverage, authorization satisfied if required, approved provider enrollment, CPT/POS/charge amount.
- [ ] Blocking result upserts an exception work item using valid existing queues: `eligibility_issue`, `authorization_issue`, `missing_documentation`/`charge_validation`, or `credentialing_issue`; avoid duplicate open items for the same reason/source.
- [ ] Ready encounters create traceable charge rows from encounter service lines. Charge becomes `ready_for_claim` only after scrub success; otherwise `blocked` with plain-language reason.
- [ ] Billing Queue has Ready to Bill, Blocked/Needs Correction, Charges Ready for Claim, Claim Created; no arbitrary status selector.
- [ ] Run tests/build; commit `feat: add billing readiness and charge workflow`.

---

### Task 7: Claims, Batch, 837P, and Clearinghouse Response

**Files:** `src/domains/claims/*`, `src/pages/claims.tsx`, `src/pages/claim-detail.tsx`, `src/App.tsx`, `tests/claim-workflow.test.ts`.

**Produces:** `createClaimFromCharges()`, `validateClaim()`, `createBatch()`, `submitBatch()`, `applySyntheticClearinghouseResponse()`.

- [ ] Test valid state sequence `ready_for_validation → ready_for_batch → batched → submitted → accepted` and reject direct submitted status without a submission record.
- [ ] Claim creation inserts `professional_claims`, `professional_claim_lines`, `claim_diagnoses` and source encounter traceability; only then mark charges `claim_created`.
- [ ] Scrub checks patient, payer, provider, service date, CPT/units/charge, diagnosis pointer, provider enrollment and billing readiness. Failure → `validation_failed` + `claim_validation` work.
- [ ] Batch creation inserts `claim_batches` + `claim_batch_items`; submission inserts `claim_submissions` with `submission_method='837P_demo'` and updates batch/claim statuses.
- [ ] Synthetic acceptance/rejection persists `submission_responses`; rejection creates `claim_rejection` work. Correction/resubmission creates a new submission record.
- [ ] Claim Submission page sections: Ready for Validation, Ready for Batch, Batches, Submissions, Rejections; actions Validate, Add to Batch, Create Batch, Submit 837P, Demo Accepted/Rejected, Correct/Resubmit.
- [ ] Claim 360 shows source encounter, lines, diagnoses, submissions, responses, status history, payments, denials, appeals and work items.
- [ ] Run tests/build; commit `feat: add claims and 837P submission workflow`.

---

### Task 8: Payment Posting and Denial Branch

**Files:** `src/domains/payments/*`, `src/App.tsx`, `tests/payment-workflow.test.ts`.

**Produces:** `postInsurancePayment()`, `allocatePayment()`, `postDemoEra()`, `createDenialFromAdjudication()`.

- [ ] Write allocation integrity tests:

```ts
assert.throws(() => validateAllocation(10000, [7000, 4000], 0), /exceed/i);
assert.doesNotThrow(() => validateAllocation(10000, [7000, 2000], 1000));
```

- [ ] Payment status rules: fully allocated=`posted`; partial=`partially_applied`; none=`unapplied`. Insert `payment_allocations`; never mark posted without reconciliation.
- [ ] Synthetic ERA persists through existing ERA/payment/adjustment tables; happy path creates payment, allocation, contractual adjustment and moves claim to `paid` only when balance is zero.
- [ ] Denied adjudication creates `denials` with CARC/RARC/category/reason/amount/workability plus `denial_followup` work; claim becomes `denied`; do not auto-create an appeal.
- [ ] Payments UI tabs: ERA/835, Insurance Payments, Allocations, Unapplied, Exceptions.
- [ ] Run tests/build; commit `feat: add payment posting and denial workflow`.

---

### Task 9: Actionable Work Center with History

**Files:** `src/domains/work-center/workflow.ts`, `src/pages/work-center.tsx`, `tests/work-center.test.ts`.

**Produces:** `startWork()`, `pendWork()`, `changePriority()`, `completeWork()`, `reopenWork()`.

- [ ] Test completing work inserts `workqueue_history` and sets completion metadata.
- [ ] Every action updates `workqueue_items` and inserts a history row; reopen clears completion metadata and records `reopened`.
- [ ] Add filters for queue, priority, status, due date, patient/provider/payer.
- [ ] Add Start, Pend/Snooze, Priority, Complete, Reopen, Open Source, History actions.
- [ ] Source records resolve to named patient/encounter/charge/claim/provider/payment/authorization/correspondence records, never UUID labels.
- [ ] Run tests/build; commit `feat: make Work Center actionable with history`.

---

### Task 10: Connected Demo Seed

**Files:** Create `supabase/seed/20260913_phase1_workflow_spine_demo.sql`.

- [ ] Seed prerequisites first: primary policy, plan, eligibility, authorization/units as applicable, provider enrollment, treatment plan/goal.
- [ ] Seed one complete clean linked path: appointment → encounter → signed note/signature → diagnosis → service line → readiness → charge → claim → line/diagnosis → batch → submission → accepted response → payment → allocation → adjustment → zero balance.
- [ ] Seed exception paths: inactive eligibility, missing authorization, unsigned/missing documentation, clearinghouse rejection, denial with CARC/RARC, credentialing block.
- [ ] Use stable scenario keys/lookup logic so rerunning the seed does not multiply demo rows.
- [ ] Apply seed and run a SQL verification query returning one row per scenario with all expected linked object IDs. No Phase 1 module may remain empty.
- [ ] Commit `test: seed connected Phase 1 demo workflows`.

---

### Task 11: Route Canonical Pages and Upgrade Command Center

**Files:** `src/App.tsx`, `src/components/app-shell.tsx`, `src/pages/dashboard.tsx`, `src/pages/restored-modules.tsx`, `src/pages/operational-workspaces.tsx`.

- [ ] Canonical routes: `/schedule`, `/schedule/:id`, `/encounters/:id`, `/billing`, `/claims`, `/claims/:id`, `/claims/submission`, `/payments`, `/work-center`.
- [ ] Sidebar hierarchy:

```text
Clinical Operations: Patients, Schedule, Encounters, Eligibility / Authorizations
Revenue Cycle: Billing, Claims, Payments, A/R & Denials
Operations: Work Center, Credentialing, Payers & Contracts, Mailroom, Reports
Administration
```

- [ ] Dashboard cards link to filtered operational destinations: Today’s Appointments, Pre-Session Blocks, Unsigned Notes, Ready to Bill, Validation Failures, Rejections, Denials, Unapplied Payments, Credentialing Blocks.
- [ ] Remove only generic exports superseded by verified Phase 1 domain pages; leave later-phase generic modules untouched.
- [ ] Run build; commit `refactor: route Phase 1 through canonical workflow domains`.

---

### Task 12: End-to-End Verification and Vercel Promotion

- [ ] Run:

```bash
pnpm --filter @workspace/therassistant-inventory test
pnpm --filter @workspace/therassistant-inventory build
pnpm --filter @workspace/therassistant-inventory typecheck
```

Tests and build must exit 0. Any unrelated legacy Inventory type errors must be documented separately and no new Phase 1 file may add errors.

- [ ] Verify anon demo RLS: SELECT/INSERT/UPDATE succeeds for demo rows and cannot escape the `Therassistant Demo` tenant.
- [ ] Live happy-path walk: patient → insurance → eligibility → appointment → pre-session → encounter → note/diagnosis/service line → sign → readiness → charge → claim → validate → batch → 837P submit → accepted response → ERA/payment → zero balance → work resolved.
- [ ] Live exception walks: inactive eligibility, missing authorization, and rejected/denied claim each produce a plain-language block plus a correct Work Center item and source link.
- [ ] Verify no raw-ID-first Phase 1 tables.
- [ ] Push branch, inspect the exact Vercel deployment commit, require `READY`.
- [ ] Create/review PR, merge to `main`, require production `READY`, then repeat the happy-path smoke walk on `https://therassistant.vercel.app`.

---

## Phase 1 Definition of Done

- Scheduling is human-readable and actionable.
- One appointment starts one encounter.
- Pre-session readiness uses insurance, eligibility, authorization and provider participation.
- Encounter documentation contains note, diagnoses, service lines and signature.
- Signing runs readiness; it does not submit a claim.
- Billing exceptions create focused Work Center items.
- Ready encounters produce traceable charges.
- Claims contain lines/diagnoses and move through validation, batch, submission and response records.
- 837P demo submission is persisted, not simulated only in UI state.
- Payment posting uses allocations and clean claims can reach zero balance.
- Denials create denial records and follow-up work.
- Work Center actions create history.
- Patient Chart and Claim 360 expose the connected chain.
- Demo seed exercises happy and exception paths.
- Production Vercel deployment is `READY` and manually verified end-to-end.
