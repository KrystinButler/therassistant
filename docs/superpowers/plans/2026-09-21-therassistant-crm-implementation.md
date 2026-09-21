# Therassistant CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, mobile-first Therassistant CRM for collection accounts, calls, documents, follow-ups, manual Square payments, textable Square payment links, payment plans, and downloadable agreements, with Brandon Burelle as the first account.

**Architecture:** Keep the CRM logically separate from the Therassistant EHR while hosting it in the same Vercel application. CRM routes bypass the EHR tenant gate and use the existing Supabase Auth session plus the existing `payment_desk_users` access model. A dedicated `crm-api` Edge Function owns CRM data and private document access; the existing `payment-desk-api` remains the only Square payment boundary and gains CRM account/payment-link linkage.

**Tech Stack:** React 19 + TypeScript + Vite + Wouter + existing UI components; Supabase Auth/Postgres/Storage/Edge Functions; Square Payments and Payment Links APIs; Vercel; `pdf-lib` for client-side agreement PDF generation.

**Spec:** `docs/superpowers/specs/2026-09-21-therassistant-crm-design.md`

## Global Constraints

- The CRM is standalone and must not depend on Therassistant EHR clinical, claims, patient-chart, or tenant workflows.
- The same Supabase Auth users and `payment_desk_users` roles authorize CRM access.
- Admin can create/delete CRM accounts and manage users; operators cannot.
- Operators can work existing accounts, log calls/notes, set follow-ups, upload/view documents, take payments, create/modify payment plans, generate agreements, and generate payment links.
- Original balance is admin-only; current balance is derived from completed payments.
- Never store PAN or CVV.
- Square access token and Supabase secret/service-role credentials stay server-side.
- CRM documents use a private Supabase Storage bucket and signed/time-limited access.
- New public-schema tables have RLS enabled and no direct anonymous access.
- Electronic signatures, recurring automatic charges, CRM-sent email, and CRM-sent SMS are out of scope.
- Payment-plan agreements are generated/downloaded, emailed manually, and returned signed copies are uploaded as documents.
- Failed or incomplete Square transactions do not reduce the account balance.
- The existing Payment Desk must continue working throughout the rollout.
- Mobile screens use stacked cards and large tap targets; do not rely on wide tables for core workflows.
- Re-check current Supabase and Square docs immediately before implementing API-specific calls.

## Review Focus

1. **Payment replay/duplicate submission:** the same payment request must not create two Square charges or double-reduce the CRM balance.
2. **Operator privilege escalation:** operators must receive backend 403 responses for account creation/deletion, original-balance edits, and user management even if UI controls are bypassed.
3. **Ambiguous payment allocation:** a payment larger than one installment must allocate oldest-due-first without exceeding remaining installment balances; overpayment remains account credit/unallocated rather than corrupting schedule totals.
4. **Private document leakage:** a CRM document URL must expire and the underlying bucket must remain non-public.
5. **Plan modification history:** changing an active plan must preserve the prior version and create a new agreement version/schedule rather than rewriting history.

---

## File Structure

### Database / backend
- New migration created by `supabase migration new add_therassistant_crm`: CRM tables, indexes, RLS, private storage bucket metadata, and transaction linkage columns.
- New: `supabase/functions/crm-api/index.ts` — authenticated CRM API.
- New: `supabase/functions/crm-api/deno.json` — pinned CRM Edge Function import map.
- Modify deployed/source `payment-desk-api` implementation and check it into `supabase/functions/payment-desk-api/index.ts`.
- New: `supabase/functions/payment-desk-api/deno.json`.
- New: `supabase/functions/_shared/crm-access.ts` — shared email/role authorization helper for CRM and Payment Desk.
- New: `supabase/functions/_shared/http.ts` — shared JSON/CORS helpers.
- New: `supabase/functions/_shared/square.ts` — Square base/version helpers.

### CRM frontend
- New: `artifacts/therassistant-inventory/src/domains/crm/types.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/crm-api.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/payment-plan.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/agreement-pdf.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/call-script.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/CrmGate.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/CrmShell.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/AccountsPage.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/AccountDetailPage.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/FollowUpsPage.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/UsersPage.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/crm.css`
- Modify: `artifacts/therassistant-inventory/src/App.tsx` — route `/crm` separately from EHR TenantGate.
- Modify: `artifacts/therassistant-inventory/package.json` and lockfile — add pinned `pdf-lib`.
- Modify: `vercel.json` only if a rewrite is needed for `/crm/*`; preserve `/payment-desk`.

### Tests
- New: `artifacts/therassistant-inventory/tests/crm-schema-contract.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-payment-plan.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-routing.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-permissions-contract.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-payment-allocation.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-agreement.test.ts`
- New: `artifacts/therassistant-inventory/tests/crm-mobile-contract.test.ts`

---

### Task 1: Create the CRM database foundation and security boundary

**Files:**
- Create via CLI: run `supabase migration new add_therassistant_crm`; edit the exact migration file emitted by that command.
- Create: `artifacts/therassistant-inventory/tests/crm-schema-contract.test.ts`

**Interfaces:**
- Produces tables `crm_accounts`, `crm_calls`, `crm_notes`, `crm_documents`, `crm_payment_plans`, `crm_payment_plan_versions`, `crm_installments`, `crm_payment_allocations`, `crm_payment_links`, and `crm_activity`.
- Produces nullable `payment_desk_transactions.crm_account_id`.
- CRM/API tasks consume these table/column names exactly.

- [ ] **Step 1: Create the migration file with the Supabase CLI**

Run:
```bash
supabase migration new add_therassistant_crm
```

Expected: Supabase prints the newly created migration path. Record that exact path in the implementation ledger and use it for every migration edit in this task.

- [ ] **Step 2: Write the failing schema contract test**

Create `artifacts/therassistant-inventory/tests/crm-schema-contract.test.ts` that reads the generated migration text and asserts it contains all required table names, RLS enables, foreign keys, indexes, private bucket creation, grants/revokes, and `payment_desk_transactions.crm_account_id`.

Test shape:
```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(process.env.CRM_MIGRATION_FILE!, "utf8");

test("CRM migration defines required isolated tables and RLS", () => {
  for (const table of [
    "crm_accounts",
    "crm_calls",
    "crm_notes",
    "crm_documents",
    "crm_payment_plans",
    "crm_payment_plan_versions",
    "crm_installments",
    "crm_payment_allocations",
    "crm_payment_links",
    "crm_activity",
  ]) {
    assert.match(migration, new RegExp(`create table(?: if not exists)? public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(migration, /crm_account_id uuid/i);
  assert.match(migration, /crm-documents/i);
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:
```bash
CRM_MIGRATION_FILE="$(ls -1t supabase/migrations/*_add_therassistant_crm.sql | head -n1)" pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-schema-contract.test.ts
```

Expected: FAIL because the fresh migration is empty.

- [ ] **Step 4: Implement the migration**

The migration must:
- use UUID primary keys with `gen_random_uuid()`;
- use `citext` only where already available/appropriate;
- store monetary values as integer cents;
- use check constraints for statuses/frequencies;
- add foreign-key indexes;
- enable RLS on every CRM table;
- revoke direct `anon` and `authenticated` table access unless explicitly needed;
- allow backend service/secret access;
- create a private `crm-documents` Storage bucket with a conservative file-size limit and ordinary office/image MIME types;
- add `crm_account_id` to `payment_desk_transactions`;
- add indexes on account/status/follow-up/due-date/created-at foreign keys;
- create `crm_payment_allocations` because one payment may satisfy multiple installments;
- create `crm_payment_links` with Square link/order identifiers and status;
- seed no business/customer data in the schema migration.

Representative table contracts:
```sql
create table public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  account_number text not null unique,
  customer_name text not null,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  original_balance_cents integer not null check (original_balance_cents >= 0),
  status text not null default 'active'
    check (status in ('active','payment_plan','paid','closed')),
  next_follow_up_at timestamptz,
  created_by citext not null,
  created_at timestamptz not null default now(),
  updated_by citext not null,
  updated_at timestamptz not null default now()
);

create table public.crm_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_desk_transactions(id) on delete cascade,
  installment_id uuid references public.crm_installments(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
```

Current balance is not an operator-editable column; API reads derive it from original balance minus completed linked payments.

- [ ] **Step 5: Run the contract test and verify GREEN**

Use the same command from Step 3.

Expected: PASS.

- [ ] **Step 6: Apply the migration to the linked Supabase project and verify**

Use current Supabase CLI help first:
```bash
supabase db --help
```

Then apply via the supported linked-project migration command shown by the installed CLI.

Verify with SQL:
```sql
select table_name
from information_schema.tables
where table_schema='public' and table_name like 'crm_%'
order by table_name;
```

Also verify all new CRM tables report RLS enabled and the `crm-documents` bucket is not public.

- [ ] **Step 7: Run Supabase security/performance advisors**

Use the Supabase MCP advisor tools or supported CLI. Resolve any new CRM Critical/Warning findings before continuing; unrelated pre-existing findings go in the ledger.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations artifacts/therassistant-inventory/tests/crm-schema-contract.test.ts
git commit -m "feat: add CRM database foundation"
```

---

### Task 2: Build the dedicated authenticated CRM API

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/_shared/crm-access.ts`
- Create: `supabase/functions/crm-api/index.ts`
- Create: `supabase/functions/crm-api/deno.json`
- Create: `artifacts/therassistant-inventory/tests/crm-permissions-contract.test.ts`

**Interfaces:**
- Consumes Task 1 CRM tables and `payment_desk_users`.
- Produces HTTP actions used by `src/domains/crm/crm-api.ts`: `me`, `accounts`, `account`, `create-account`, `update-account`, `delete-account`, `calls`, `create-call`, `notes`, `create-note`, `follow-ups`, `activity`, `create-document-upload`, `finalize-document`, `document-download`.

- [ ] **Step 1: Write the failing permissions/API contract test**

The test reads `crm-api/index.ts` and asserts:
- it uses `withSupabase({ auth: "user" })`;
- access is checked against `payment_desk_users`;
- admin guard is required for account create/delete/original-balance mutation;
- operator actions exist;
- signed document URL actions exist.

Example:
```ts
test("CRM API enforces admin-only account lifecycle", () => {
  const source = fs.readFileSync(apiPath, "utf8");
  assert.match(source, /withSupabase\(\{ auth: ["']user["'] \}/);
  assert.match(source, /payment_desk_users/);
  assert.match(source, /create-account/);
  assert.match(source, /delete-account/);
  assert.match(source, /Administrator access required/);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-permissions-contract.test.ts
```

Expected: FAIL because the function does not exist.

- [ ] **Step 3: Implement shared access and HTTP helpers**

`crm-access.ts` exports:
```ts
export type CrmAccess = {
  email: string;
  displayName: string;
  role: "admin" | "operator";
  active: boolean;
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireCrmAccess(ctx: any): Promise<CrmAccess> {
  const email = String(ctx.userClaims?.email ?? "").trim().toLowerCase();
  if (!email) throw new HttpError(401, "Authenticated email is required.");

  const { data, error } = await ctx.supabaseAdmin
    .from("payment_desk_users")
    .select("email,display_name,role,active")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new HttpError(500, "Unable to verify CRM access.");
  if (!data?.active) throw new HttpError(403, "This account is not authorized for CRM.");

  return {
    email,
    displayName: data.display_name || email,
    role: data.role,
    active: true,
  };
}

export function requireAdmin(access: CrmAccess): void {
  if (access.role !== "admin") {
    throw new HttpError(403, "Administrator access required.");
  }
}
```

Do not authorize from user-editable JWT metadata.

- [ ] **Step 4: Implement `crm-api` read/write actions**

All mutations:
- validate input;
- stamp `created_by`/`updated_by` from authenticated access;
- write a `crm_activity` record in the same request path;
- return only account-scoped records;
- never trust client-provided role/operator email.

Admin-only:
- create account;
- delete/close account;
- modify original balance.

Operator allowed:
- update contact/status/follow-up fields except original balance;
- create calls/notes;
- document signed URL flow.

Account response includes derived:
```ts
{
  originalBalanceCents,
  completedPaymentsCents,
  currentBalanceCents,
  nextInstallment,
  activePlan
}
```

- [ ] **Step 5: Implement private document upload/download flow**

Backend creates an object path with `const objectPath = `${accountId}/${crypto.randomUUID()}/${safeFileName}`;`, finalizes metadata only after upload, and returns signed download URLs with short expiration.

Reject file sizes/types outside the migration's configured allowlist before issuing upload credentials.

- [ ] **Step 6: Run GREEN**

Run the Task 2 test command plus TypeScript syntax/static checks available for Edge Functions.

- [ ] **Step 7: Deploy `crm-api` with `verify_jwt=false` because authorization is handled by `@supabase/server`**

Use the current Supabase deployment tool/CLI and verify:
- unauthenticated request returns 401;
- authorized admin `me` returns admin;
- operator cannot invoke `create-account`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions artifacts/therassistant-inventory/tests/crm-permissions-contract.test.ts
git commit -m "feat: add authenticated CRM API"
```

---

### Task 3: Implement payment-plan calculation, versioning, and allocation logic

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/crm/payment-plan.ts`
- Create: `artifacts/therassistant-inventory/tests/crm-payment-plan.test.ts`
- Create: `artifacts/therassistant-inventory/tests/crm-payment-allocation.test.ts`
- Modify: `supabase/functions/crm-api/index.ts`

**Interfaces:**
- Produces `buildInstallmentSchedule(input)`, `allocatePaymentOldestDueFirst(input)`, and CRM API actions `create-plan`, `modify-plan`, `plan`, `set-agreement-status`.
- Later UI consumes the exact plan/installment shapes defined in `types.ts`.

- [ ] **Step 1: Write failing schedule tests**

Cover:
- weekly, biweekly, monthly;
- down payment;
- final installment smaller than regular installment;
- exact division;
- zero/negative invalid values;
- month-end date behavior;
- no schedule total greater than remaining balance.

Representative assertion:
```ts
assert.deepEqual(
  buildInstallmentSchedule({
    remainingBalanceCents: 110000,
    installmentCents: 30000,
    frequency: "monthly",
    firstDueDate: "2026-10-01",
  }).map((x) => x.amountCents),
  [30000, 30000, 30000, 20000],
);
```

- [ ] **Step 2: Write failing allocation tests**

Cover:
- one payment equals one installment;
- payment spans multiple installments;
- partial installment;
- overpayment leaves unallocated remainder;
- already-paid installments are skipped.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test   ../artifacts/therassistant-inventory/tests/crm-payment-plan.test.ts   ../artifacts/therassistant-inventory/tests/crm-payment-allocation.test.ts
```

- [ ] **Step 4: Implement pure calculation helpers**

Use integer cents only and deterministic ISO dates.

```ts
import { addDays, addMonths, format, parseISO } from "date-fns";

export type PlanFrequency = "weekly" | "biweekly" | "monthly";

export function buildInstallmentSchedule(input: {
  remainingBalanceCents: number;
  installmentCents: number;
  frequency: PlanFrequency;
  firstDueDate: string;
}): Array<{ sequence: number; dueDate: string; amountCents: number }> {
  const { remainingBalanceCents, installmentCents, frequency, firstDueDate } = input;
  if (!Number.isInteger(remainingBalanceCents) || remainingBalanceCents <= 0) {
    throw new Error("Remaining balance must be a positive integer number of cents.");
  }
  if (!Number.isInteger(installmentCents) || installmentCents <= 0) {
    throw new Error("Installment amount must be a positive integer number of cents.");
  }

  const increment = (date: Date) =>
    frequency === "weekly"
      ? addDays(date, 7)
      : frequency === "biweekly"
        ? addDays(date, 14)
        : addMonths(date, 1);

  const schedule: Array<{ sequence: number; dueDate: string; amountCents: number }> = [];
  let remaining = remainingBalanceCents;
  let due = parseISO(firstDueDate);
  let sequence = 1;

  while (remaining > 0) {
    const amountCents = Math.min(installmentCents, remaining);
    schedule.push({
      sequence,
      dueDate: format(due, "yyyy-MM-dd"),
      amountCents,
    });
    remaining -= amountCents;
    due = increment(due);
    sequence += 1;
  }

  return schedule;
}
```

- [ ] **Step 5: Run GREEN**

Use the Step 3 command.

- [ ] **Step 6: Add CRM API plan actions and immutable version snapshots**

On create/modify:
- validate plan math server-side independently of browser helpers;
- insert/update plan;
- insert `crm_payment_plan_versions` snapshot JSON;
- regenerate future installments;
- preserve paid historical installments;
- increment agreement version;
- write activity.

Material modification marks agreement status `generated` or `not_generated` according to whether the replacement PDF has been generated.

- [ ] **Step 7: Verify against Supabase with a temporary test account inside a transaction where possible**

Verify schedule rows sum exactly to the remaining balance and version count increments on modification.

- [ ] **Step 8: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/crm/payment-plan.ts   artifacts/therassistant-inventory/tests/crm-payment-plan.test.ts   artifacts/therassistant-inventory/tests/crm-payment-allocation.test.ts   supabase/functions/crm-api/index.ts
git commit -m "feat: add CRM payment plans and allocations"
```

---

### Task 4: Bring the production Payment Desk source into the repo and link Square operations to CRM

**Files:**
- Create from deployed source: `supabase/functions/payment-desk-api/index.ts`
- Create: `supabase/functions/payment-desk-api/deno.json`
- Modify: `supabase/functions/_shared/crm-access.ts`
- Create: `artifacts/therassistant-inventory/tests/crm-payment-link-contract.test.ts`

**Interfaces:**
- Consumes `crm_accounts`, `crm_installments`, `crm_payment_allocations`, `crm_payment_links`.
- Existing `charge` accepts optional `crmAccountId` and `crmInstallmentId`.
- New `create-payment-link` returns `{ paymentLinkId, orderId, url, amountCents }`.
- New `refresh-payment-link` reports latest Square status without silently creating a second payment.

- [ ] **Step 1: Fetch the deployed `payment-desk-api` source and save it verbatim into the repo**

Do not reconstruct it from memory. Confirm the checked-in SHA/source matches the deployed function before modifying.

- [ ] **Step 2: Write a failing contract test**

Assert:
- existing idempotency logic remains;
- charge accepts CRM linkage;
- payment link actions exist;
- Square token is read only from `Deno.env`;
- no PAN/CVV fields are persisted.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-payment-link-contract.test.ts
```

- [ ] **Step 4: Extend `charge` safely**

If `crmAccountId` is supplied:
- verify account exists;
- save `crm_account_id` on transaction;
- on completed Square payment, allocate against requested/oldest due installments;
- write CRM activity;
- leave balance derived from completed linked transactions.

Do not alter existing non-CRM Payment Desk behavior.

- [ ] **Step 5: Add Square Payment Link creation**

Before coding, consult the current Square Payment Links API docs for the project Square API version.

Server request uses the CRM account/reference and amount but does not expose secrets to the browser.

Persist `crm_payment_links` with account, amount, Square link/order IDs, URL, operator, and status.

- [ ] **Step 6: Add manual payment-link status refresh**

Query Square by stored identifiers. If a payment is found completed and not already recorded, create one `payment_desk_transactions` row with a deterministic idempotency/import key and allocate it once. If not paid, update link status only.

- [ ] **Step 7: Run GREEN and regression-check the existing Payment Desk**

Run the new test and a production-safe `me`/history request. Use Square sandbox or a non-charge status query for backend verification; do not create a real charge for automated testing.

- [ ] **Step 8: Deploy a new version and verify the existing production Payment Desk still renders and can load config/history**

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/payment-desk-api supabase/functions/_shared   artifacts/therassistant-inventory/tests/crm-payment-link-contract.test.ts
git commit -m "feat: link Square payment desk to CRM"
```

---

### Task 5: Add the CRM frontend route and API client without entering the EHR TenantGate

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/crm/types.ts`
- Create: `artifacts/therassistant-inventory/src/domains/crm/crm-api.ts`
- Create: `artifacts/therassistant-inventory/src/domains/crm/CrmGate.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/crm/CrmShell.tsx`
- Create: `artifacts/therassistant-inventory/tests/crm-routing.test.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`

**Interfaces:**
- `CrmGate` consumes existing `useAuth()` only, not `useTenant()`.
- `crmApi(action, options)` attaches current Supabase access token and talks only to `crm-api`.
- CRM routes: `/crm`, `/crm/accounts/:id`, `/crm/follow-ups`, `/crm/users`.

- [ ] **Step 1: Write failing route isolation test**

Read `App.tsx` and assert:
- `/crm` routes are detected before `TenantGate`;
- CRM imports do not import EHR domains or `tenant-context`;
- `/payment-desk` remains intact.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-routing.test.ts
```

- [ ] **Step 3: Implement CRM types and authenticated client**

Define exact response models for Account, Call, Note, Document, Activity, Plan, Installment, Payment, PaymentLink, CrmUser.

`crmApi` obtains the session from the existing Supabase client/auth context and sends `Authorization: Bearer ${session.access_token}`.

- [ ] **Step 4: Implement `CrmGate` and CRM route switch**

Behavior:
- unauthenticated CRM URL renders existing `LoginPage`;
- authenticated but unauthorized user sees a CRM access error;
- authorized user gets `CrmShell`;
- no EHR organization setup is required for CRM operators.

- [ ] **Step 5: Run GREEN, typecheck, and build**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-routing.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck
pnpm --filter @workspace/therassistant-inventory run build
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/App.tsx   artifacts/therassistant-inventory/src/domains/crm   artifacts/therassistant-inventory/tests/crm-routing.test.ts
git commit -m "feat: add isolated CRM frontend routing"
```

---

### Task 6: Build mobile-first accounts, calls, notes, follow-ups, and call-script workflows

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/crm/AccountsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/crm/AccountDetailPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/crm/FollowUpsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/crm/call-script.ts`
- Create: `artifacts/therassistant-inventory/src/domains/crm/crm.css`
- Create: `artifacts/therassistant-inventory/tests/crm-mobile-contract.test.ts`

**Interfaces:**
- Consumes Task 5 `crmApi` and models.
- Produces quick actions: Take Payment, Text Payment Link, Log Call, Add Document, Help / Call Script.

- [ ] **Step 1: Write failing mobile UI contract tests**

Assert source contains:
- required quick-action labels;
- account tabs/sections;
- call dispositions;
- no core account table forced wider than viewport;
- CSS breakpoint rules and touch-sized controls;
- help/call-script content.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-mobile-contract.test.ts
```

- [ ] **Step 3: Implement Accounts page**

Admin sees `New Account`; operators do not.

Each account card shows customer, current balance, status, next follow-up, and opens detail.

- [ ] **Step 4: Implement account detail**

Top summary:
- customer;
- current/original balance;
- status;
- next follow-up;
- quick actions.

Sections:
- Overview;
- Payment Plan;
- Calls;
- Documents;
- Payments;
- Notes;
- Activity.

- [ ] **Step 5: Implement Log Call panel**

Fields:
`direction`, `disposition`, `notes`, optional promise amount/date, optional next follow-up.

Saving refreshes timeline and follow-up summary.

- [ ] **Step 6: Implement Help / Call Script panel**

`call-script.ts` returns contextual strings using safe interpolation of account values. It includes all script sections from the spec and never writes data itself.

- [ ] **Step 7: Implement Follow-Ups page**

Group overdue/today/upcoming using account cards; opening an item navigates to account.

- [ ] **Step 8: Run GREEN, typecheck, build**

Use Task 6 test plus:
```bash
pnpm --filter @workspace/therassistant-inventory run typecheck
pnpm --filter @workspace/therassistant-inventory run build
```

- [ ] **Step 9: Browser-verify at mobile and desktop widths**

Using agent-browser:
- 390x844 phone;
- 768x1024 tablet;
- 1440x900 desktop.

Verify no horizontal scrolling in core account workflows and quick actions are reachable.

- [ ] **Step 10: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/crm   artifacts/therassistant-inventory/tests/crm-mobile-contract.test.ts
git commit -m "feat: add mobile CRM account workflows"
```

---

### Task 7: Add private CRM document upload/download

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/crm/AccountDetailPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/crm/crm-api.ts`
- Create: `artifacts/therassistant-inventory/tests/crm-documents-contract.test.ts`

**Interfaces:**
- Uses CRM API signed upload/download actions from Task 2.
- Browser never receives service-role/secret credentials or a permanent public document URL.

- [ ] **Step 1: Write failing document security test**

Assert:
- UI requests signed upload data from CRM API;
- bucket name is private and not hardcoded to a public URL;
- downloads come from signed API response;
- accepted file metadata is validated.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-documents-contract.test.ts
```

- [ ] **Step 3: Implement upload flow**

Mobile supports file picker/camera/photo where browser permits. UI:
1. choose category;
2. choose file;
3. request signed upload;
4. upload bytes;
5. finalize metadata;
6. refresh Documents and Activity.

- [ ] **Step 4: Implement signed download/open flow**

Clicking a document requests a fresh signed URL and opens/downloads it. Do not persist signed URLs in database.

- [ ] **Step 5: Run GREEN and browser-test with one harmless PDF/image**

Confirm the Storage bucket remains private and expired signed URL fails after its lifetime.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/crm   artifacts/therassistant-inventory/tests/crm-documents-contract.test.ts
git commit -m "feat: add private CRM documents"
```

---

### Task 8: Integrate manual Square payments and textable payment links into the CRM

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/crm/AccountDetailPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/crm/crm-api.ts`
- New: `artifacts/therassistant-inventory/src/domains/crm/PaymentPanel.tsx`
- New: `artifacts/therassistant-inventory/src/domains/crm/PaymentLinkPanel.tsx`
- New: `artifacts/therassistant-inventory/tests/crm-payment-ui.test.ts`

**Interfaces:**
- Payment Panel calls `payment-desk-api?action=charge` with `crmAccountId`.
- Payment Link Panel calls `create-payment-link` / `refresh-payment-link`.
- Mobile text action uses `const smsHref = `sms:${phone.replace(/[^\\d+]/g, "")}?body=${encodeURIComponent(message)}`;`.

- [ ] **Step 1: Write failing UI/payment safety tests**

Cover:
- Take Payment requires amount and CRM account;
- Text Payment Link offers Full Balance / Next Installment / Custom;
- SMS body is URI-encoded;
- no access token or Square secret is present in frontend source.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-payment-ui.test.ts
```

- [ ] **Step 3: Reuse the existing Square Web Payments SDK flow inside CRM PaymentPanel**

Do not create a second card-processing implementation with different tokenization semantics. Preserve `sellerKeyedIn`/card-not-present handling already proven by Payment Desk.

- [ ] **Step 4: Implement Payment Link panel**

After link creation show:
- Copy Link;
- Text Payment Link;
- amount;
- link status;
- Refresh Status.

The prewritten text must identify Therassistant and amount without including sensitive account details.

- [ ] **Step 5: Run GREEN and perform Square sandbox tests**

Test:
- manual $1 sandbox payment linked to a temporary CRM account;
- generated payment link;
- SMS URI generation on phone/emulation;
- status refresh;
- one completed transaction only.

- [ ] **Step 6: Verify account balance and activity**

Completed payment reduces derived balance exactly once and appears in Payments + Activity.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/crm   artifacts/therassistant-inventory/tests/crm-payment-ui.test.ts
git commit -m "feat: add CRM payments and payment links"
```

---

### Task 9: Build downloadable payment-plan agreement PDFs and signed-agreement workflow

**Files:**
- Modify: `artifacts/therassistant-inventory/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/therassistant-inventory/src/domains/crm/agreement-pdf.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/crm/AccountDetailPage.tsx`
- Create: `artifacts/therassistant-inventory/tests/crm-agreement.test.ts`

**Interfaces:**
- Agreement PDF consumes account + current plan + installment schedule + business template config.
- Produces a `Uint8Array` PDF download.
- Agreement generation updates agreement status/version through CRM API; returned signed PDF is uploaded through Documents.

- [ ] **Step 1: Add pinned `pdf-lib` dependency**

Use pnpm only:
```bash
pnpm --filter @workspace/therassistant-inventory add pdf-lib@1.17.1
```

Use exactly `pdf-lib@1.17.1`, the current stable upstream release verified during planning, and keep the resulting lockfile change.

- [ ] **Step 2: Write failing agreement tests**

Test the pure agreement data builder, not binary PDF rendering only.

Assertions include:
- customer/account;
- balance;
- down payment;
- frequency;
- all installment rows;
- agreement ID/version/date;
- signature/date lines;
- missed-payment/default language;
- modification language;
- special terms;
- no electronic-signature language.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-agreement.test.ts
```

- [ ] **Step 4: Implement agreement content builder and PDF renderer**

Use a deterministic `buildAgreementModel()` then `renderAgreementPdf()` with page wrapping/page breaks.

Do not hardcode unapproved legal promises. Use the admin-approved template text stored in this module/config.

- [ ] **Step 5: Implement UI workflow**

Payment Plan section:
- Create/Modify plan;
- Generate Agreement;
- Download Agreement;
- Mark Sent;
- Mark Signed;
- Mark Declined;
- Upload Signed Agreement.

Material plan modification increments agreement version and requires a new generated agreement.

- [ ] **Step 6: Run GREEN and inspect generated PDF manually**

Open the PDF and verify:
- no clipped text;
- schedule readable;
- signature lines present;
- correct amounts/dates;
- page count reasonable on phone/desktop download.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/package.json pnpm-lock.yaml   artifacts/therassistant-inventory/src/domains/crm   artifacts/therassistant-inventory/tests/crm-agreement.test.ts
git commit -m "feat: add CRM payment plan agreements"
```

---

### Task 10: Create Brandon as the first CRM account and safely link existing payments

**Files:**
- Create via CLI: run `supabase migration new seed_initial_crm_account`; edit the exact emitted migration file only after data review.
- Create: `docs/crm/brandon-migration-review.md`

**Interfaces:**
- Consumes production `payment_desk_transactions`.
- Produces one Brandon CRM account and only confidently matched payment links.

- [ ] **Step 1: Query existing transactions without mutating**

Inspect:
```sql
select id, created_at, customer_name, amount_cents, square_payment_id, square_status, reference
from public.payment_desk_transactions
order by created_at;
```

- [ ] **Step 2: Document the exact matching rule**

Only rows with a clear customer identity/reference matching Brandon are eligible. Put candidate IDs and reasons in `docs/crm/brandon-migration-review.md`.

Ambiguous rows stay unlinked.

- [ ] **Step 3: Create the seed migration with the Supabase CLI**

```bash
supabase migration new seed_initial_crm_account
```

- [ ] **Step 4: Insert Brandon account using admin-confirmed original balance**

If the original balance has not been explicitly confirmed at execution time, STOP and ask the admin before writing the insert. Do not infer it from historical memory or transaction totals.

- [ ] **Step 5: Link only reviewed transaction IDs**

Use explicit IDs from Step 2, never a broad `customer_name ilike` update.

- [ ] **Step 6: Apply and verify**

Check derived balance equals original balance minus completed linked payments and Activity includes the migration/account creation event.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations docs/crm/brandon-migration-review.md
git commit -m "data: add initial CRM account"
```

---

### Task 11: Production QA, security review, deployment, and Payment Desk compatibility

**Files:**
- Modify only files required by verification findings.
- Update: `docs/crm/production-checklist.md`

**Interfaces:**
- Validates every success criterion in the approved spec.

- [ ] **Step 1: Run the full CRM test suite**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/crm-*.test.ts
```

Expected: 0 failures.

- [ ] **Step 2: Run application typecheck and production build**

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: exit 0 for both.

- [ ] **Step 3: Run Supabase advisors**

Check security, performance, and current service-health advisors. Resolve new CRM findings. Document unrelated pre-existing findings separately.

- [ ] **Step 4: Verify permissions with two roles**

Admin:
- can create account;
- can edit original balance;
- can manage users.

Operator:
- can log call/note/document/payment/plan;
- gets 403 for create/delete account, original-balance change, and user management.

- [ ] **Step 5: Verify mobile workflow end-to-end**

On a phone-sized viewport:
1. sign in;
2. open Brandon/test account;
3. log call;
4. set follow-up;
5. upload document;
6. generate payment plan;
7. download agreement;
8. upload signed-agreement test file;
9. sandbox payment;
10. generate/copy/text payment link;
11. inspect Activity.

- [ ] **Step 6: Verify existing `/payment-desk`**

It must still load over HTTPS and retain production Square configuration without exposing secrets.

- [ ] **Step 7: Deploy production Vercel build**

Wait for READY and fetch:
- `/crm`
- `/payment-desk`

Both must return successful HTTPS pages.

- [ ] **Step 8: Complete production checklist**

`docs/crm/production-checklist.md` records each approved-spec success criterion and the evidence used to verify it.

- [ ] **Step 9: Final review**

Run `git diff`, confirm no secrets, PAN/CVV, private tokens, or unintended EHR coupling. Then use the requesting-code-review workflow, resolve Critical/Important findings with RED→GREEN verification, and rerun Steps 1–7.

- [ ] **Step 10: Finish branch**

Use the finishing-a-development-branch workflow only after fresh verification is green.
