# Phase 5 Mailroom & Correspondence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin Mailroom table with a connected correspondence workflow that supports classification, human-readable operational links, due dates, Work Center follow-up, auditable state transitions, and private document upload/open behavior.

**Architecture:** Keep `mailroom_items` as the correspondence workflow source of truth and reuse `documents`, `workqueue_items`, `workqueue_history`, `status_history`, and the private `therassistant-documents` Storage bucket. Put pure status/due-date rules in `src/domains/mailroom/workflow.ts`, data aggregation and mutations in `repository.ts`, storage access in a focused browser-safe storage adapter, and use one SECURITY INVOKER database RPC for atomic Mailroom/Work Center/status-history transitions. The UI receives a dedicated Mailroom inbox and Correspondence 360 route. Existing Phase 2–4 workflow behavior remains untouched except for Work Center source enrichment/routing.

**Tech Stack:** React, TypeScript, Vite, Wouter, Node test runner, Supabase/Postgres, Supabase Storage REST API, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-14-phase-5-mailroom-correspondence.md`

## Global Constraints

- Preserve the current synthetic `Therassistant Demo` architecture; no real PHI.
- Do not expose service-role keys, `sb_secret_` keys, or other privileged credentials in browser code.
- Keep the existing private `therassistant-documents` bucket private.
- Do not create a second attachment table, workqueue system, or generalized relationship framework.
- No raw UUIDs as normal user-facing identifiers.
- Mailroom status changes must use explicit workflow actions, not arbitrary status dropdown updates.
- Do not broaden the TypeScript scope to unrelated legacy typing debt. Phase 5 uses the established production `typecheck:phase3` gate unless Vercel's production build contract changes.
- New RLS/storage access for the browser demo must be limited to the `Therassistant Demo` tenant and the Phase 5 document path.
- Preserve current Work Center semantics for `open`, `in_progress`, `pending`, `snoozed`, `completed`, `cancelled`, and `reopened`.
- Use the current `workqueue_items.assigned_user_id` convention: `auth.users(id)`. Do not invent a second assignee identifier.
- Every implementation task follows RED → GREEN → commit.

---

## File Structure

### Create

- `artifacts/therassistant-inventory/src/domains/mailroom/types.ts` — Mailroom status/action/data contracts.
- `artifacts/therassistant-inventory/src/domains/mailroom/workflow.ts` — pure lifecycle, due-date, priority, work-item, history, and filtering rules.
- `artifacts/therassistant-inventory/src/domains/mailroom/repository.ts` — aggregate loading, creation/classification, transition RPC calls, document metadata linkage, and assignee lookup.
- `artifacts/therassistant-inventory/src/domains/mailroom/MailroomPage.tsx` — actionable inbox and add-correspondence workflow.
- `artifacts/therassistant-inventory/src/domains/mailroom/CorrespondencePage.tsx` — Correspondence 360 workspace.
- `artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts` — browser-safe private Storage upload, delete-cleanup, and signed-open adapter.
- `artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts` — lifecycle, due state, work payload, filtering, and history tests.
- `artifacts/therassistant-inventory/tests/mailroom-repository.test.ts` — aggregate enrichment and document-link orchestration tests.
- `artifacts/therassistant-inventory/tests/supabase-demo-storage.test.ts` — Storage request/path/cleanup tests using injected fetch.
- `supabase/migrations/20260914_phase5_mailroom_correspondence.sql` — fields, FKs, indexes, enum values, transition RPC, scoped history/storage policies, and demo assignee lookup.
- `supabase/migrations/20260914_phase5_mailroom_demo_seed.sql` — five deterministic synthetic Mailroom scenarios.
- `.github/workflows/phase5-ci.yml` — Phase 5 tests, production TypeScript gate, secret scan, build, and route smokes.

### Modify

- `artifacts/therassistant-inventory/src/App.tsx` — route `/mailroom/:id` before `/mailroom`, switch to domain pages.
- `artifacts/therassistant-inventory/src/pages/operational-workspaces.tsx` — remove only the legacy `MailroomPage` implementation/export.
- `artifacts/therassistant-inventory/src/domains/work-center/repository.ts` — enrich `mailroom_item` sources and route to exact correspondence.
- `artifacts/therassistant-inventory/tests/work-center.test.ts` — assert Mailroom source routing.
- `artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts` — export browser-safe project URL/publishable key for the focused Storage adapter; no behavior change to existing data methods.
- `artifacts/therassistant-inventory/src/domains/demo/scenarios.ts` — add Phase 5 Mailroom scenario cards.
- `artifacts/therassistant-inventory/tests/demo-scenarios.test.ts` — verify the Phase 5 scenario set.
- `artifacts/therassistant-inventory/src/pages/demo-control.tsx` — add a separate Phase 5 Mailroom demo section without changing existing Phase 1 stories.

---

## Task 1: Define the Mailroom lifecycle as pure domain behavior

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/mailroom/types.ts`
- Create: `artifacts/therassistant-inventory/src/domains/mailroom/workflow.ts`
- Create: `artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts`

**Interfaces:**

```ts
export type CorrespondenceStatus =
  | "new"
  | "reviewed"
  | "action_required"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed";

export type CorrespondenceAction =
  | "review"
  | "require_action"
  | "start"
  | "pend"
  | "resolve"
  | "close"
  | "reopen";

export type CorrespondenceDueState =
  | "none"
  | "current"
  | "due_soon"
  | "overdue";
```

- [ ] Write tests that assert the exact transition matrix from the approved spec.

```ts
assert.deepEqual(availableCorrespondenceActions("new").map(a => a.action), [
  "review", "require_action", "close",
]);
assert.deepEqual(availableCorrespondenceActions("closed").map(a => a.action), [
  "reopen",
]);
```

- [ ] Write tests that reject impossible transitions such as `new -> resolved`, `reviewed -> in_progress`, and `closed -> closed`.
- [ ] Write deterministic due-state tests using `2026-09-14` as the injected current date: no due date, future/current, due within 7 calendar days, and overdue.
- [ ] Write priority tests: overdue → `urgent`, due soon → `high`, otherwise → `normal`.
- [ ] Write a test for `buildCorrespondenceWorkItem()` asserting:

```ts
{
  workqueue_type: "correspondence",
  workqueue_status: "open",
  source_object_type: "mailroom_item",
  source_object_id: "mail-1",
  due_date: "2026-09-18",
  priority: "high",
}
```

- [ ] Write a test for `buildCorrespondenceHistory()` asserting `target_type: "mailroom_item"` and old/new status preservation.
- [ ] Write filtering/sorting tests covering search text, status, type, payer, assignment, overdue/due-soon, received-date sort, and due-date sort. Keep filtering as a pure helper so the page does not own business rules.
- [ ] Run only the new test and confirm RED because the Mailroom domain does not exist:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts
```

- [ ] Implement the smallest pure helpers required by the tests. Keep them database-free and use the canonical transition table from the spec.
- [ ] Re-run the test and confirm GREEN.
- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/domains/mailroom artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts
git commit -m "feat: define Mailroom correspondence workflow"
```

---

## Task 2: Add the Phase 5 schema, scoped security, and atomic transition RPC

**Files:**
- Create: `supabase/migrations/20260914_phase5_mailroom_correspondence.sql`

**Schema contract:**

Add nullable columns to `public.mailroom_items`:

```sql
client_id uuid references public.clients(id),
provider_id uuid references public.providers(id),
authorization_id uuid references public.authorizations(id),
appeal_id uuid references public.appeals(id),
document_id uuid references public.documents(id),
assigned_user_id uuid references auth.users(id) on delete set null,
due_date date,
reviewed_at timestamptz,
closed_at timestamptz
```

Add a check constraint limiting `status` to:

```text
new, reviewed, action_required, in_progress, pending, resolved, closed
```

Add enum values:

```sql
alter type public.workqueue_type_enum add value if not exists 'correspondence';
alter type public.workqueue_source_object_type_enum add value if not exists 'mailroom_item';
```

- [ ] Before writing DDL, run the existing full test suite to record a green baseline:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

- [ ] Write the migration with focused indexes for inbox/status/due and relationship enrichment:

```sql
create index if not exists mailroom_items_tenant_status_received_idx
  on public.mailroom_items (tenant_id, status, received_date desc);
create index if not exists mailroom_items_tenant_due_idx
  on public.mailroom_items (tenant_id, due_date)
  where due_date is not null;
create index if not exists mailroom_items_client_idx
  on public.mailroom_items (tenant_id, client_id);
create index if not exists mailroom_items_provider_idx
  on public.mailroom_items (tenant_id, provider_id);
create index if not exists mailroom_items_claim_idx
  on public.mailroom_items (tenant_id, claim_id);
create index if not exists mailroom_items_payer_idx
  on public.mailroom_items (tenant_id, payer_id);
```

- [ ] Add a lookup index for correspondence work without embedding the newly added enum literal in a partial-index predicate in the same enum migration:

```sql
create index if not exists workqueue_correspondence_lookup_idx
  on public.workqueue_items
    (tenant_id, source_object_type, source_object_id, workqueue_type, workqueue_status);
```

- [ ] Grant `anon` only the missing `SELECT`/`INSERT` access needed for `status_history`, and add policies scoped to the `Therassistant Demo` tenant. Do not grant `UPDATE` or `DELETE` on `status_history`.
- [ ] Preserve the existing demo-scoped `mailroom_items` and `workqueue_items` policies rather than replacing them with broader policies.
- [ ] Add private Storage policies for `anon` on `storage.objects` limited to bucket `therassistant-documents` and the path convention:

```text
demo/<therassistant-demo-tenant-id>/mailroom/<mailroom-item-id>/<object-name>
```

The policies allow only `SELECT`, `INSERT`, and `DELETE` for that path. `DELETE` exists solely for failed-upload cleanup. Do not add anon `UPDATE` or a bucket-wide policy.
- [ ] Add `public.get_demo_mailroom_assignees()` returning only `user_id` and a display label for active users attached to the demo tenant. Make it a narrowly scoped read-only `SECURITY DEFINER` function, set a safe search path, revoke default public execution, and explicitly grant execution to `anon` and `authenticated`. Do not expose email/phone.
- [ ] Add `public.transition_demo_mailroom_item(p_mailroom_item_id uuid, p_action text, p_reason text default null)` as `SECURITY INVOKER`. It must:
  - lock the Mailroom row `FOR UPDATE`;
  - verify the row belongs to `Therassistant Demo`;
  - validate the approved action against the current status;
  - set `reviewed_at` on review and `closed_at` on close;
  - clear `closed_at` on reopen;
  - insert exactly one `status_history` row for every actual Mailroom status change;
  - find active correspondence work by `workqueue_type='correspondence'`, `source_object_type='mailroom_item'`, and source ID;
  - create work only when entering `action_required` and no active item exists;
  - derive priority from due date using the same overdue/7-day rule as TypeScript;
  - move the work item to `in_progress` or `pending` when the Mailroom action does so;
  - complete work and write `workqueue_history` when resolving;
  - reject close while any active correspondence work remains;
  - on reopen, reuse the newest completed/cancelled correspondence work item when available by setting it to `reopened`, clearing completion fields, and recording history; otherwise create a new open work item;
  - return the updated Mailroom row.

- [ ] Do not rely on a partial unique index for duplicate prevention in this migration. The RPC is the only Mailroom status mutation path and must lock the Mailroom row before checking/creating active work, which serializes concurrent action-required transitions for that correspondence item.
- [ ] Apply the migration through the Supabase migration tool as `phase5_mailroom_correspondence`.
- [ ] Verify the nine new columns, check constraint, both enum values, indexes, function signatures, grants, RLS policies, and Storage policies using read-only SQL.
- [ ] Exercise the transition RPC in a rollback-only SQL transaction using a synthetic Mailroom row: `new -> action_required -> in_progress -> pending -> in_progress -> resolved -> closed -> action_required`. Verify one active work item maximum and matching history at each step, then `ROLLBACK`.
- [ ] Run Supabase security/performance advisors and fix only new Phase 5-specific findings before proceeding.
- [ ] Commit:

```bash
git add supabase/migrations/20260914_phase5_mailroom_correspondence.sql
git commit -m "feat: add Mailroom correspondence schema and transitions"
```

---

## Task 3: Build the Mailroom repository and aggregate enrichment

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/mailroom/repository.ts`
- Create: `artifacts/therassistant-inventory/tests/mailroom-repository.test.ts`

**Repository surface:**

```ts
export async function getMailroomInbox(): Promise<MailroomInboxItem[]>;
export async function getCorrespondenceDetail(id: string): Promise<CorrespondenceDetail | null>;
export async function getMailroomReferenceData(): Promise<MailroomReferenceData>;
export async function createCorrespondence(input: CreateCorrespondenceInput): Promise<MailroomRow>;
export async function classifyCorrespondence(id: string, values: ClassifyCorrespondenceInput): Promise<MailroomRow>;
export async function transitionCorrespondence(id: string, action: CorrespondenceAction, reason?: string): Promise<MailroomRow>;
export async function linkCorrespondenceDocument(id: string, documentId: string): Promise<MailroomRow>;
```

- [ ] Write RED tests for a pure exported aggregate builder that receives Mailroom rows plus clients, providers, payers, claims, authorizations, appeals, documents, status history, work items, and assignee labels.
- [ ] Assert the aggregate resolves patient/provider/payer names, claim control number, linked document, active work, chronological status history, due state, and an assignee display label without showing raw IDs.
- [ ] Assert a missing linked record degrades to an explicit human-readable fallback rather than throwing for the whole inbox.
- [ ] Assert detail lookup returns `null` for an unknown correspondence ID.
- [ ] Run the repository test and confirm RED.
- [ ] Implement live loaders with `demoSelect`, `referenceSelect`, and the assignee RPC. Fetch only existing Therassistant tables; do not use `therassistant-api.ts` as a new dependency.
- [ ] Implement `createCorrespondence()` with default `status: "new"`, supplied `received_date`, nullable context IDs, notes, due date, and assignee.
- [ ] Implement `classifyCorrespondence()` as context/type/detail editing only. It must not directly write a status.
- [ ] Implement `transitionCorrespondence()` as the single browser repository call to `transition_demo_mailroom_item`.
- [ ] Implement `linkCorrespondenceDocument()` as a controlled update of only `document_id`.
- [ ] Re-run repository + workflow tests and confirm GREEN.
- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/domains/mailroom/repository.ts artifacts/therassistant-inventory/tests/mailroom-repository.test.ts
git commit -m "feat: add Mailroom repository and aggregates"
```

---

## Task 4: Add private document upload, cleanup, and signed-open behavior

**Files:**
- Create: `artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts`
- Modify: `artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/mailroom/repository.ts`
- Create: `artifacts/therassistant-inventory/tests/supabase-demo-storage.test.ts`
- Modify: `artifacts/therassistant-inventory/tests/mailroom-repository.test.ts`

**Storage surface:**

```ts
export function createDemoStorage(fetchImpl?: typeof fetch): {
  uploadMailroomFile(input: {
    tenantId: string;
    mailroomItemId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }): Promise<{ path: string }>;
  createSignedDocumentUrl(path: string, expiresIn?: number): Promise<string>;
  deleteObject(path: string): Promise<void>;
};
```

- [ ] Export only `SUPABASE_URL` and the existing publishable key constant from `supabase-demo-client.ts`; do not export or introduce privileged keys.
- [ ] Write RED fetch-adapter tests that verify the object path always starts with `demo/<tenantId>/mailroom/<mailroomItemId>/` and sanitizes the original filename.
- [ ] Test upload request headers/body and failure reporting with injected fake fetch.
- [ ] Test signed URL creation for a private document and assert the adapter returns a time-limited URL rather than a public bucket URL.
- [ ] Test cleanup `DELETE` is called when metadata creation fails after a successful object upload.
- [ ] Implement the adapter against Supabase Storage REST using only the publishable browser key. Keep bucket name fixed to `therassistant-documents`.
- [ ] Add repository orchestration:

```ts
export async function addCorrespondenceDocument(
  correspondence: MailroomRow,
  file: File,
): Promise<MailroomRow>
```

It must:
1. resolve the demo tenant ID;
2. upload to the scoped Mailroom path;
3. insert a `documents` record using an existing compatible `document_type_enum` value;
4. link its `document_id` to the Mailroom item;
5. delete the uploaded Storage object if document metadata insertion fails;
6. if metadata exists but Mailroom linking fails, return a clear recoverable error explaining that the document was saved and can be linked from existing documents rather than deleting valid metadata silently.

- [ ] Map correspondence types to existing document enum values, e.g. EOB → `eob`, appeal/reconsideration → `appeal_letter`, prior-auth → `authorization_letter`, and other payer correspondence → `payer_correspondence`/`other`.
- [ ] Add `openCorrespondenceDocument()` that requests a short-lived signed URL and lets the page open/download it. Supabase private-bucket signed access requires Storage `SELECT`; do not make the bucket public. citeturn491156search2turn491156search3
- [ ] Run Storage and repository tests and confirm GREEN.
- [ ] Run the browser secret scan manually:

```bash
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then exit 1; fi
```

- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts artifacts/therassistant-inventory/src/domains/mailroom/repository.ts artifacts/therassistant-inventory/tests/supabase-demo-storage.test.ts artifacts/therassistant-inventory/tests/mailroom-repository.test.ts
git commit -m "feat: add private Mailroom document handling"
```

---

## Task 5: Replace the thin Mailroom page with the actionable inbox

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/mailroom/MailroomPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/mailroom/workflow.ts`
- Modify: `artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts`

- [ ] Extend RED tests for inbox filtering/sorting if any UI-needed behavior was not covered in Task 1; keep the behavior in pure helpers, not JSX.
- [ ] Build the inbox with columns for received date, subject, type, payer, patient, claim/control number, provider, due date, assignee, status, and action/priority state.
- [ ] Add search across subject, patient, claim number, payer, and provider.
- [ ] Add status, correspondence-type, payer, assignment, and due-state filters plus newest/oldest/due-date sorting.
- [ ] Render overdue/due-soon state explicitly. Do not infer urgency independently in JSX; use the domain helper.
- [ ] Add `Open` links to `/mailroom/:id` and do not render UUID values as labels.
- [ ] Add an `Add Correspondence` modal/form containing subject, received date, type, payer, patient, claim, provider, authorization/appeal where relevant, due date, notes, assignee when demo assignees exist, existing document, optional file upload, and `Requires action` checkbox.
- [ ] When a patient is selected, filter/prefer claims and authorizations belonging to that patient.
- [ ] Save sequence:
  1. create Mailroom row;
  2. link selected existing document or upload the selected new document;
  3. if `Requires action` is checked, call `transitionCorrespondence(id, "require_action", reason)`;
  4. reload and navigate/open the created correspondence.
- [ ] Display specific errors for failed create/upload/link/action routing. Never leave the user with a silent partial state.
- [ ] Run Mailroom tests plus production TypeScript gate:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/mailroom-*.test.ts ../artifacts/therassistant-inventory/tests/supabase-demo-storage.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/domains/mailroom/MailroomPage.tsx artifacts/therassistant-inventory/src/domains/mailroom/workflow.ts artifacts/therassistant-inventory/tests/mailroom-workflow.test.ts
git commit -m "feat: build actionable Mailroom inbox"
```

---

## Task 6: Build Correspondence 360 and wire the routes

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/mailroom/CorrespondencePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/operational-workspaces.tsx`

- [ ] Add the exact route before the list route:

```tsx
<Route path="/mailroom/:id"><CorrespondencePage /></Route>
<Route path="/mailroom"><MailroomPage /></Route>
```

- [ ] Replace the `MailroomPage` import from `pages/operational-workspaces` with imports from `domains/mailroom`.
- [ ] Remove only the legacy Mailroom component from `operational-workspaces.tsx`. Do not refactor Schedule, Reports, Payments, or other unrelated legacy workspaces in this phase.
- [ ] Build Correspondence 360 with a breadcrumb to Mailroom and header fields: subject, type, status, received, due, payer, assignee, and overdue/due-soon state.
- [ ] Add linked context cards/links:
  - patient → `/clients/:id`;
  - claim → `/claims/:id`;
  - provider → `/providers/:id`;
  - payer → `/payers/:id`;
  - authorization → `/authorizations` with human-readable authorization number/context;
  - appeal → `/ar-denials` with human-readable appeal context.
- [ ] Add a document panel showing file name, type, status, upload/link-existing action, and private open/download action via signed URL. Show a deliberate empty state when no document is attached.
- [ ] Add a work/history panel showing active/completed correspondence work and chronological `status_history` entries.
- [ ] Render only actions returned by `availableCorrespondenceActions(currentStatus)`:
  - Review;
  - Require Action;
  - Start Work;
  - Pend;
  - Resolve;
  - Close;
  - Reopen.
- [ ] Require a reason for Pend, Resolve, Close, and Reopen in the UI before calling the transition repository. The database remains authoritative for transition validity.
- [ ] Add classification/context editing that calls `classifyCorrespondence()` and does not mutate status.
- [ ] Verify `/mailroom/<known-or-synthetic-id>` loads a clear not-found state for an invalid ID rather than crashing.
- [ ] Run all Mailroom tests, production typecheck, and build:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/mailroom-*.test.ts ../artifacts/therassistant-inventory/tests/supabase-demo-storage.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
```

- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/domains/mailroom/CorrespondencePage.tsx artifacts/therassistant-inventory/src/App.tsx artifacts/therassistant-inventory/src/pages/operational-workspaces.tsx
git commit -m "feat: add Correspondence 360 workspace"
```

---

## Task 7: Integrate Mailroom correspondence into Work Center

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/work-center/repository.ts`
- Modify: `artifacts/therassistant-inventory/tests/work-center.test.ts`

- [ ] Add a failing test:

```ts
assert.equal(
  sourceRouteForWorkItem("mailroom_item", "mail-1"),
  "/mailroom/mail-1",
);
```

- [ ] Add aggregate tests or a small exported context helper test proving a `mailroom_item` source resolves linked patient, provider, payer, and subject without exposing IDs.
- [ ] Run `work-center.test.ts` and confirm RED.
- [ ] Add `mailroom_items` to `getWorkCenterData()` loading and build a `mailroomById` map.
- [ ] Add:

```ts
case "mailroom_item": return `/mailroom/${id}`;
```

- [ ] In Work Center context resolution for `mailroom_item`, derive:
  - `clientId` from `mailroom_items.client_id`, falling back to linked claim client when needed;
  - `providerId` from `provider_id`;
  - `payerId` from `payer_id`, falling back to linked claim payer when needed;
  - `relatedName` from the correspondence subject plus patient/claim context.
- [ ] Do not duplicate Mailroom transition logic inside Work Center. The Work Center remains capable of its existing independent item actions, while Correspondence 360 uses the atomic Mailroom transition RPC to keep the two state machines synchronized.
- [ ] Run Work Center + Mailroom tests and confirm GREEN.
- [ ] Commit:

```bash
git add artifacts/therassistant-inventory/src/domains/work-center/repository.ts artifacts/therassistant-inventory/tests/work-center.test.ts
git commit -m "feat: route correspondence through Work Center"
```

---

## Task 8: Seed five deterministic Phase 5 scenarios and expose them in Demo Control

**Files:**
- Create: `supabase/migrations/20260914_phase5_mailroom_demo_seed.sql`
- Modify: `artifacts/therassistant-inventory/src/domains/demo/scenarios.ts`
- Modify: `artifacts/therassistant-inventory/tests/demo-scenarios.test.ts`
- Modify: `artifacts/therassistant-inventory/src/pages/demo-control.tsx`

- [ ] Choose five fixed Mailroom item UUIDs for the synthetic scenarios so links are stable, but resolve the tenant/payer/patient/provider/claim IDs from existing synthetic data by natural demo identifiers in SQL instead of hardcoding references to generated production IDs.
- [ ] Write the seed migration idempotently using `INSERT ... ON CONFLICT (id) DO UPDATE` or equivalent for:
  1. new payer correspondence awaiting review;
  2. medical-record request due within 7 days with active correspondence work;
  3. recoupment/refund correspondence linked to a claim;
  4. credentialing letter linked to provider + payer;
  5. resolved correspondence with completed work and status/work history.
- [ ] Keep all seeded records under the `Therassistant Demo` tenant and do not touch non-demo rows.
- [ ] Apply the seed migration and verify the five records and related work/history counts.
- [ ] Add `phase5MailroomScenarios` to `src/domains/demo/scenarios.ts`, each linking directly to its fixed `/mailroom/:id` route.
- [ ] Add RED assertions to `demo-scenarios.test.ts` for count, titles, and Mailroom hrefs; run and confirm RED before implementing the array.
- [ ] Add a separate `Phase 5 Mailroom Scenarios` section to `DemoControlCenter`. Do not rename the existing `phase1DemoScenarios` or alter their expected list.
- [ ] Re-run demo-scenario and Mailroom tests and confirm GREEN.
- [ ] Commit:

```bash
git add supabase/migrations/20260914_phase5_mailroom_demo_seed.sql artifacts/therassistant-inventory/src/domains/demo/scenarios.ts artifacts/therassistant-inventory/tests/demo-scenarios.test.ts artifacts/therassistant-inventory/src/pages/demo-control.tsx
git commit -m "feat: add Phase 5 Mailroom demo scenarios"
```

---

## Task 9: Add the Phase 5 CI gate and run the complete regression suite

**Files:**
- Create: `.github/workflows/phase5-ci.yml`

- [ ] Copy the established Phase 4 CI structure, rename it `Phase 5 CI`, and trigger branch pushes for `phase-5-mailroom-correspondence` plus pull requests to `main`.
- [ ] Keep the exact established install/runtime versions: Node 24 and pnpm 10.28.0.
- [ ] Run all inventory tests:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

- [ ] Use the existing production TypeScript gate:

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Do not create a broad `tsconfig.phase5.json` unless the established Vercel production gate demonstrably omits a new Phase 5 file. If that happens, extend the production gate narrowly to include Phase 5 code rather than pulling unrelated dynamic API typing debt into scope.

- [ ] Retain the browser secret scan:

```bash
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then
  echo "Forbidden Supabase server secret marker found in browser source."
  exit 1
fi
```

- [ ] Run the production Vite build.
- [ ] Start `vite preview` and smoke:

```text
/mailroom
/mailroom/75000000-0000-4000-8000-000000000001
/work-center
```

Use the first deterministic Mailroom scenario UUID from Task 8 for the detail route. Each route must return HTTP 200 and the built SPA root element.
- [ ] Run the workflow locally/through GitHub and fix only Phase 5 failures.
- [ ] On pull request, require the existing Phase 2, Phase 3, Phase 4 regression workflows plus Phase 5 CI to pass.
- [ ] Commit:

```bash
git add .github/workflows/phase5-ci.yml
git commit -m "ci: add Phase 5 Mailroom verification"
```

---

## Task 10: Final verification, preview, and merge-readiness review

**Files:** No planned product-code changes; fixes discovered by verification receive their own tests/commits.

- [ ] Run the complete test suite from the exact branch head and record the pass count:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

- [ ] Run production TypeScript gate, secret scan, and production build from the same head.
- [ ] Verify Supabase migration state includes both Phase 5 migrations.
- [ ] Query the live demo database to confirm:
  - new Mailroom columns and FKs;
  - status constraint;
  - enum values;
  - transition/assignee RPCs;
  - five deterministic demo records;
  - no duplicate active correspondence work for any source item.
- [ ] Re-run Supabase security and performance advisors. Document pre-existing unrelated notices separately; Phase 5 must introduce no blocking finding.
- [ ] Push branch and confirm Phase 5 CI succeeds on the exact head SHA.
- [ ] Confirm Vercel creates a preview for that exact SHA and reaches `READY`.
- [ ] Smoke preview `/mailroom`, one real seeded `/mailroom/:id`, and `/work-center`. Verify the Mailroom list, detail, and Work Center correspondence link all render.
- [ ] Exercise one synthetic status workflow in the preview: new/reviewed → action required → start → pend → start → resolve → close. Confirm the matching Work Center item follows it and history is visible.
- [ ] Exercise document upload on synthetic data, open it through a signed private URL, and verify the object remains under the scoped `demo/<tenant>/mailroom/...` path. Clean up only the synthetic verification object if needed.
- [ ] Check Vercel runtime errors for the preview after the route/action exercises.
- [ ] Compare `phase-5-mailroom-correspondence` against `main` and confirm changes stay limited to Mailroom, Work Center integration, demo scenarios, scoped Supabase/storage changes, tests, docs, and CI.
- [ ] Open a PR titled `Phase 5: Mailroom and Correspondence` only after every gate above passes. Include exact head SHA, test count, CI results, Vercel preview state, Supabase migration/advisor status, and any known nonblocking pre-existing technical debt.
- [ ] Do not merge until explicit user approval.
