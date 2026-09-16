# Patient Portal Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved THERASSISTANT patient portal experience with an in-between-session journal, guided pre-visit check-in, and balance-threshold access workflow while preserving the existing portal root and provider-facing data connections.

**Architecture:** Keep `client_checkins` and `patient_journal_entries` as the source records already consumed by the provider schedule. Add only the portal-specific fields and two small financial-arrangement request tables required by the approved design. Patient portal routes render outside the staff `AppShell` inside a dedicated `PortalShell`; each page uses the portal repository rather than querying Supabase directly.

**Tech Stack:** React, TypeScript, Vite, Wouter, existing THERASSISTANT components/CSS, Supabase/Postgres, existing demo repository utilities, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-integrated-ehr-workspaces-design.md`

## Global Constraints

- Preserve `/patient-portal/:clientId` as the portal root.
- Add `/patient-portal/:clientId/journal`, `/patient-portal/:clientId/check-in/:appointmentId`, and `/patient-portal/:clientId/access`.
- Patient-authored content remains separate from signed clinical documentation and is imported only through an explicit later clinical action.
- Use the canonical pre-visit keys in `src/domains/portal/check-in-contract.ts`; do not create alternate field names.
- A journal draft must never appear in provider pre-session context.
- The balance threshold must come from `tenants.settings.portal_balance_threshold_cents`; never hard-code it in a page component.
- A patient over threshold regains unrestricted portal access only when the open balance is at/below threshold, a payment plan is `active`, or a balance exception is `approved`.
- Do not simulate a successful card/ACH transaction. The payment action must clearly state that online processing is not connected in this phase.
- Patient-submitted payment-plan requests and exception requests are persisted as `pending`; submission alone does not lift the access restriction.
- Do not add another UI library.
- No browser `alert()` or `prompt()` interactions.
- Run affected tests, full TypeScript/typecheck, production build, and SPA route smoke verification before completion.

---

## File structure

- Create `supabase/migrations/20260916_integrated_patient_portal.sql` — journal extensions, patient payment plans, balance exception requests, demo threshold configuration, RLS/grants.
- Modify `artifacts/therassistant-inventory/src/domains/portal/workflow.ts` — journal values, access evaluation, check-in response merging.
- Modify `artifacts/therassistant-inventory/src/domains/portal/repository.ts` — portal aggregation and new write actions.
- Modify `artifacts/therassistant-inventory/tests/patient-portal.test.ts` — pure workflow tests.
- Modify `artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts` — exclude draft journal entries from provider context.
- Create `artifacts/therassistant-inventory/src/domains/portal/PortalShell.tsx` — patient navigation and portal layout.
- Create `artifacts/therassistant-inventory/src/domains/portal/portal.css` — patient-facing responsive styling.
- Create `artifacts/therassistant-inventory/src/domains/portal/PortalJournalPage.tsx` — journal composer and recent entries.
- Create `artifacts/therassistant-inventory/src/domains/portal/PortalCheckInPage.tsx` — five-section pre-visit flow.
- Create `artifacts/therassistant-inventory/src/domains/portal/PortalAccessPage.tsx` — threshold restriction and resolution requests.
- Modify `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx` — portal home using the shared shell and access gate.
- Modify `artifacts/therassistant-inventory/src/App.tsx` — portal routes outside staff `AppShell`.
- Modify `.github/workflows/phase2-ci.yml` — smoke the three new portal routes.

### Task 1: Define portal journal and access workflow contracts

**Files:**
- Modify: `artifacts/therassistant-inventory/tests/patient-portal.test.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/workflow.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts`

**Interfaces:**
- `JournalEntryDraft = { entryText: string; mood?: string; tags?: string[]; relatedGoalId?: string | null; visibility?: "private" | "shared_with_provider"; entryStatus?: "draft" | "submitted" }`
- `buildJournalEntryValues(input: JournalEntryDraft): Row`
- `evaluatePortalAccess(input): PortalAccessState`
- `mergePreVisitResponses(current, patch): Record<string, unknown>`

- [ ] **Step 1: Add failing tests for journal state, access state, and response merging**

Add tests equivalent to:

```ts
test("journal draft remains private from provider context until submitted", () => {
  const values = buildJournalEntryValues({
    entryText: "Working through stress",
    tags: ["stress", "sleep"],
    visibility: "shared_with_provider",
    entryStatus: "draft",
  });
  assert.equal(values.entry_status, "draft");
  assert.equal(values.visibility, "shared_with_provider");
  assert.equal(values.submitted_at, null);
});

test("portal access is restricted only above threshold without an approved resolution", () => {
  assert.equal(evaluatePortalAccess({ openBalanceCents: 32500, thresholdCents: 20000, activePaymentPlan: false, approvedException: false }).restricted, true);
  assert.equal(evaluatePortalAccess({ openBalanceCents: 20000, thresholdCents: 20000, activePaymentPlan: false, approvedException: false }).restricted, false);
  assert.equal(evaluatePortalAccess({ openBalanceCents: 32500, thresholdCents: 20000, activePaymentPlan: true, approvedException: false }).restricted, false);
});

test("pre-visit response patch preserves prior answers", () => {
  assert.deepEqual(
    mergePreVisitResponses({ focus_today: "Anxiety" }, { recent_changes: "New job" }),
    { focus_today: "Anxiety", recent_changes: "New job" },
  );
});
```

Also extend `patient-review.test.ts` with a draft shared journal and assert it is excluded.

- [ ] **Step 2: Run targeted tests and verify RED**

```bash
node --experimental-strip-types --test \
  artifacts/therassistant-inventory/tests/patient-portal.test.ts \
  artifacts/therassistant-inventory/tests/patient-review.test.ts
```

Expected: failures because the new contracts do not exist yet.

- [ ] **Step 3: Implement the pure workflow functions**

`buildJournalEntryValues` must return existing fields plus:

```ts
{
  entry_text: text,
  mood: input.mood?.trim() || null,
  author_type: "patient",
  review_status: "unreviewed",
  visibility: input.visibility ?? "shared_with_provider",
  tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
  related_treatment_goal_id: input.relatedGoalId || null,
  entry_status: input.entryStatus ?? "submitted",
  submitted_at: (input.entryStatus ?? "submitted") === "submitted" ? new Date().toISOString() : null,
}
```

`evaluatePortalAccess` returns `{ restricted, reason, openBalanceCents, thresholdCents }`; `thresholdCents === null` means no restriction. `mergePreVisitResponses` shallow-merges JSON objects and drops `undefined` patch values.

Update scheduling `isSharedJournal` so `entry_status === "draft"` is excluded before visibility checks.

- [ ] **Step 4: Re-run targeted tests and verify GREEN**

Use the same command; expected all pass.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/workflow.ts artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts artifacts/therassistant-inventory/tests/patient-portal.test.ts artifacts/therassistant-inventory/tests/patient-review.test.ts
git commit -m "feat: define patient portal workflow contracts"
```

### Task 2: Add the smallest required portal persistence model

**Files:**
- Create: `supabase/migrations/20260916_integrated_patient_portal.sql`

**Interfaces:**
- Adds journal columns: `visibility`, `tags`, `related_treatment_goal_id`, `entry_status`, `submitted_at`.
- Creates `patient_payment_plans` and `portal_balance_exception_requests`.
- Stores the demo threshold in `tenants.settings.portal_balance_threshold_cents`.

- [ ] **Step 1: Create an idempotent migration**

The migration must use `add column if not exists` and create these constraints/data shapes:

```sql
alter table public.patient_journal_entries
  add column if not exists visibility text not null default 'shared_with_provider',
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists related_treatment_goal_id uuid references public.treatment_plan_goals(id),
  add column if not exists entry_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz;

create table if not exists public.patient_payment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_monthly_amount_cents bigint,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_balance_exception_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add check constraints for journal visibility/status, plan status (`pending`, `active`, `completed`, `cancelled`, `declined`), and exception status (`pending`, `approved`, `denied`). Backfill existing journal rows to `entry_status='submitted'`, `visibility='shared_with_provider'`, and `submitted_at=coalesce(submitted_at, created_at)`.

Set the synthetic demo practice setting without changing non-demo tenants:

```sql
update public.tenants
set settings = coalesce(settings, '{}'::jsonb) || '{"portal_balance_threshold_cents":20000}'::jsonb
where coalesce((settings->>'demo')::boolean, false) = true;
```

Enable RLS and mirror the existing synthetic-demo read/insert/update pattern for the two new tables; revoke destructive anonymous privileges.

- [ ] **Step 2: Apply the migration to the connected Supabase project**

Use the connected Supabase migration tool against project `lpjwfdvaxobewxcklenl`; do not execute DDL through the ordinary SQL-query action.

- [ ] **Step 3: Verify schema and security advisors**

Query `information_schema.columns` for the new fields/tables, then run Supabase security advisors. Fix any new RLS/security issue attributable to this migration before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260916_integrated_patient_portal.sql
git commit -m "feat: add patient portal persistence model"
```

### Task 3: Extend the portal repository

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/portal/repository.ts`

**Interfaces:**
- `getPatientPortalData(patientId)` additionally returns `treatmentGoals`, `portalAccess`, `paymentPlans`, `exceptionRequests`.
- `saveJournalEntry(patientId, input)` replaces the duplicated journal insert path for portal UI.
- `savePreVisitResponses(appointmentId, patientId, patch, options?)` merges rather than replaces `responses`.
- `requestPaymentPlan(patientId, monthlyAmountCents)` inserts a pending plan.
- `requestBalanceException(patientId, reason)` inserts a pending exception.

- [ ] **Step 1: Extend the read aggregation**

Load the patient tenant, current treatment plans/goals, current balance, plans, and exceptions. Read threshold with:

```ts
const thresholdValue = tenant?.settings && typeof tenant.settings === "object"
  ? Number((tenant.settings as Record<string, unknown>).portal_balance_threshold_cents)
  : Number.NaN;
const thresholdCents = Number.isFinite(thresholdValue) ? thresholdValue : null;
```

Use `evaluatePortalAccess` with an `active` payment plan and an `approved` exception.

- [ ] **Step 2: Add journal persistence**

Use `buildJournalEntryValues(input)` and `demoInsert("patient_journal_entries", { client_id: patientId, ...values })`. Do not write clinical-note fields.

- [ ] **Step 3: Add merged pre-visit persistence**

Fetch the existing `client_checkins` row, merge existing `responses` with `mergePreVisitResponses`, and update/insert one row. On final submit set `checked_in_at` and `responses.submitted_at` in the same repository action.

- [ ] **Step 4: Add payment-plan and exception request actions**

Resolve tenant ID from the patient record, validate monthly amount is a positive integer when supplied, require a non-empty exception reason, and insert records with `status:'pending'`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/repository.ts
git commit -m "feat: connect patient portal workflows"
```

### Task 4: Build the patient portal shell and route separation

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/PortalShell.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/portal/portal.css`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`

**Interfaces:**
- `PortalShell({ clientId, patientName, active, nextAppointmentId, children, sideRail? })`.
- Portal routes render without the staff `AppShell`.

- [ ] **Step 1: Build `PortalShell`**

Render THERASSISTANT patient-facing header, left navigation for Home, Journal, Check-In (when a next appointment exists), Billing/Access, and a compact account identity. Use `Link` for all routes and an `active` prop for selected state.

- [ ] **Step 2: Add patient-facing responsive CSS**

Use navy/sage tokens already in the app. Desktop has a narrow left rail plus content; at <= 780px navigation becomes a compact horizontal/stacked region and content uses one column. Do not duplicate global component styles.

- [ ] **Step 3: Move portal routing outside staff `AppShell`**

Refactor `App.tsx` to a top-level `Switch`: all four `/patient-portal/...` routes render directly; a fallback route renders `AppShell` containing the existing staff routes. Do not alter any staff route path/component pairing.

- [ ] **Step 4: Typecheck/build**

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/PortalShell.tsx artifacts/therassistant-inventory/src/domains/portal/portal.css artifacts/therassistant-inventory/src/App.tsx
git commit -m "feat: add patient portal shell"
```

### Task 5: Build the In-Between Session Journal page

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/PortalJournalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`

**Interfaces:**
- Uses `saveJournalEntry`, `getPatientPortalData`, treatment goals, and `PortalShell`.
- Composer fields: reflection, mood, symptom tags, related goal, visibility.

- [ ] **Step 1: Implement the journal composer**

Provide mood choices `Very rough`, `Rough`, `Okay`, `Better`, `Good`; symptom tag toggles `Anxiety`, `Low mood`, `Stress`, `Sleep`, `Panic`, `Focus`; related-goal select; and visibility `Share with provider` / `Save privately`.

`Save Draft` calls `saveJournalEntry(... entryStatus:'draft')`. `Save Entry` calls `entryStatus:'submitted'`. Both preserve the selected visibility, but draft rows remain excluded from provider context by Task 1.

- [ ] **Step 2: Render recent entries**

Show entry date, mood, tags, related goal label when resolvable, and visibility/status badges. Make `Draft`, `Private`, and `Shared with provider` explicit text states.

- [ ] **Step 3: Update portal home**

Replace the large inline journal form in `PatientPortalPage` with a summary card linking to the Journal page. Keep appointments/coverage/documents/balance summaries.

- [ ] **Step 4: Verify**

Typecheck/build and confirm `/patient-portal/:clientId/journal` renders from the built SPA.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/PortalJournalPage.tsx artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx
git commit -m "feat: add patient session journal"
```

### Task 6: Build guided Pre-Visit Check-In

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/PortalCheckInPage.tsx`

**Interfaces:**
- Uses canonical storage keys `focus_today`, `mood_since_last_visit`, `recent_changes`, `safety_concerns`, `goal_focus`, `provider_message`.
- Uses `savePreVisitResponses` for each section and final submit.

- [ ] **Step 1: Validate route appointment ownership**

Load portal data and locate `appointmentId` in the current patient's appointments. If absent, render an actionable portal error rather than querying another patient's appointment.

- [ ] **Step 2: Implement the five-section flow**

Render step navigation and collapsible/section cards:

1. Demographics — read-only current values; Continue stores `demographics_reviewed_at`.
2. Insurance — active policy summary; Continue stores `insurance_reviewed_at`.
3. Visit Questions — controlled inputs for the six canonical pre-visit keys.
4. Consents & Acknowledgments — checkbox plus timestamp `consents_acknowledged_at`.
5. Review & Submit — display all answers and submit.

Persist each completed section so refresh does not erase progress.

- [ ] **Step 3: Final submission**

Call `savePreVisitResponses(..., { submitted_at: new Date().toISOString() }, { markCheckedIn:true })`. After success show `Check-in complete` and a link back to portal Home. This must make the provider Schedule/Patient Review read `Ready` through the existing `client_checkins` record.

- [ ] **Step 4: Verify**

Typecheck/build and run the full patient portal test plus patient-review test.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/PortalCheckInPage.tsx
git commit -m "feat: add guided pre-visit check-in"
```

### Task 7: Build balance access restriction and resolution requests

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/PortalAccessPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PortalJournalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PortalCheckInPage.tsx`

**Interfaces:**
- All content pages gate through `data.portalAccess.restricted`.
- The access page always remains reachable.

- [ ] **Step 1: Implement `PortalAccessPage`**

Show current open balance and configured threshold. Render three cards:

- **Make a Payment:** state plainly that online payment processing is not connected in this phase; provide a non-destructive `Message/Contact Billing` route/action if available, otherwise explanatory text only. Do not create a payment record.
- **Payment Plan:** monthly amount input and `Submit Payment Plan Request`; persist `pending` via repository.
- **Request an Exception:** reason textarea and submit; persist `pending` via repository.

Show pending/active/approved status from existing records.

- [ ] **Step 2: Gate restricted portal content**

In Home, Journal, and Check-In pages, if `portalAccess.restricted` render a concise `PortalAccessGate` linking to `/patient-portal/:clientId/access` instead of protected page content. The access route itself never redirects back into the gate.

- [ ] **Step 3: Verify access rules**

Pure tests must cover balance below threshold, above threshold, active plan, approved exception, and missing threshold. UI must not say access is restored for a merely `pending` request.

- [ ] **Step 4: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal
git commit -m "feat: add patient portal balance access workflow"
```

### Task 8: Portal regression, CI routes, and preview verification

**Files:**
- Modify: `.github/workflows/phase2-ci.yml`

- [ ] **Step 1: Extend SPA smoke routes**

Add representative synthetic routes:

```bash
"/patient-portal/ff648f71-9c94-433c-9aab-f80b039a80fd/journal"
"/patient-portal/ff648f71-9c94-433c-9aab-f80b039a80fd/check-in/55000000-0000-4000-8000-000000000006"
"/patient-portal/ff648f71-9c94-433c-9aab-f80b039a80fd/access"
```

If the referenced appointment does not belong to the patient, use a real synthetic appointment ID from the current seeded demo instead of weakening the route ownership validation.

- [ ] **Step 2: Run the full verification gate**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

All commands must exit 0.

- [ ] **Step 3: Verify provider integration**

Create/submit a synthetic pre-visit response and a shared submitted journal entry, then confirm the scheduling repository returns those values in `patientReview`. Confirm a draft journal does not appear.

- [ ] **Step 4: Verify CI and Vercel**

Push the final phase commit; require GitHub Actions success and a `READY` Vercel preview before calling this portal phase complete.

- [ ] **Step 5: Commit any verification-only route changes**

```bash
git add .github/workflows/phase2-ci.yml
git commit -m "test: smoke integrated patient portal routes"
```

## Self-review coverage

- Journal: free text, mood, symptoms/tags, goal link, sharing choice, draft/submitted, recent visibility states.
- Check-in: demographics, insurance, visit questions, consents, review/submit, provider schedule integration.
- Access: practice-configured threshold, payment/plan/exception choices, no fake payment, pending requests do not unlock access.
- Architecture: portal routes remain compatible, patient pages are separate from staff shell, repositories remain authoritative, no duplicate patient/appointment models.
- Safety/data boundary: patient content stays patient-authored and is not silently copied into signed clinical documentation.
