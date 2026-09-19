# Secure Patient Portal Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Therassistant's patient-ID/public-key portal with staff-invited Supabase Auth accounts whose database access is restricted by patient-specific RLS and narrow portal RPCs.

**Architecture:** Staff creates the clinical patient record first, then a JWT-protected Supabase Edge Function sends the Auth invitation and creates a `client_portal_access` mapping. Patient routes run inside the existing Auth provider, resolve the mapped client from `auth.uid()`, and use RLS for reads plus narrow security-definer RPCs for check-in and journaling writes. URL client IDs are removed from patient navigation and never participate in authorization.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Wouter 3.3, Node 24, pnpm 10.28.0, Supabase Postgres/RLS/Auth/Edge Functions, `@supabase/supabase-js@2.116.0` pinned for the Edge Function, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-17-secure-patient-portal-auth-design.md`

## Global Constraints

- Never authorize patient access from a URL `clientId`, patient-supplied `tenant_id`, or `user_metadata`.
- Keep staff tenant authorization and patient portal authorization separate.
- No Supabase service-role/secret key may appear in `artifacts/therassistant-inventory/src` or any Vite/browser-visible variable.
- The invitation Edge Function must deploy with `verify_jwt=true`.
- Patient data is readable only when `client_portal_access.status = 'active'`.
- An `invited` or `revoked` mapping must not read clinical/financial patient data.
- Patient writes must go through narrow RPCs that derive the client from `auth.uid()`; do not grant broad patient UPDATE access.
- Saving a patient and sending an invitation are separate lifecycle steps. An invitation failure must never encourage or require recreating the patient.
- Do not send real production invitation emails from automated tests.
- Preserve existing staff RLS and the disabled demo-tenant behavior unless a task explicitly replaces a portal-only demo path.
- Pin Edge Function Supabase JS to `2.116.0`; do not add an unpinned package import. Current npm latest was verified on 2026-09-17.
- Use the existing publishable key in browser requests; use the authenticated user's Bearer JWT for patient and staff calls.
- Use fixed `search_path` on every new database function. For every SECURITY DEFINER function, revoke default PUBLIC/anon execution and grant only the role that needs it.
- Run Supabase security and performance advisors after DDL changes.
- No guardian/proxy UI, patient self-registration, patient payments, portal messaging, or clinical-note exposure in this release.

---

## File Map

### Create

- `supabase/migrations/<cli-generated-version>_secure_patient_portal_auth.sql` — portal access table, staff/patient access helpers, context/activation/revocation functions, patient read RLS.
- `supabase/migrations/<cli-generated-version>_secure_patient_portal_writes.sql` — narrow patient check-in, previsit, and journal RPCs.
- `supabase/functions/invite-patient-portal/deno.json` — pins `@supabase/supabase-js@2.116.0`.
- `supabase/functions/invite-patient-portal/logic.ts` — dependency-free invitation input/status decisions.
- `supabase/functions/invite-patient-portal/index.ts` — JWT-protected staff invitation handler and compensating cleanup.
- `artifacts/therassistant-inventory/src/domains/portal/routes.ts` — patient portal route constants/builders with no client IDs.
- `artifacts/therassistant-inventory/src/domains/portal/portal-client.ts` — authenticated REST/RPC client for patient portal calls.
- `artifacts/therassistant-inventory/src/domains/portal/PatientPortalGate.tsx` — authenticated patient mapping/status gate.
- `artifacts/therassistant-inventory/src/domains/portal/PatientPortalLoginPage.tsx` — patient-specific sign-in/reset entry point.
- `artifacts/therassistant-inventory/src/domains/portal/PatientPortalActivatePage.tsx` — invitation password setup and mapping activation.
- `artifacts/therassistant-inventory/src/domains/portal/PatientPortalRecoveryPage.tsx` — patient password recovery completion.
- `artifacts/therassistant-inventory/src/domains/portal/staff-portal-access.ts` — staff invitation/status/revoke browser calls.
- `artifacts/therassistant-inventory/src/domains/portal/PortalAccessPanel.tsx` — Patient 360 portal status/actions.
- `artifacts/therassistant-inventory/src/domains/patients/create-patient-with-portal.ts` — orchestration that creates once and treats invitation failure as a retryable secondary failure.
- `artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts` — migration/auth/routing security contracts.
- `artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts` — narrow-RPC and authenticated client contracts.
- `artifacts/therassistant-inventory/tests/patient-portal-invite.test.ts` — invitation pure-logic and source-security tests.
- `artifacts/therassistant-inventory/tests/patient-portal-enrollment.test.ts` — create-once/invite-failure orchestration tests.

### Modify

- `artifacts/therassistant-inventory/src/lib/supabase-client.ts` — preserve invite/recovery auth flow type and support route-specific recovery redirect.
- `artifacts/therassistant-inventory/src/auth/auth-context.tsx` — expose auth flow type and generic password completion for invite/recovery.
- `artifacts/therassistant-inventory/src/App.tsx` — put portal inside `AuthProvider`; replace client-ID routes with gated portal routes.
- `artifacts/therassistant-inventory/src/domains/portal/repository.ts` — remove caller-supplied patient ID and use authenticated context/RPCs.
- `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx` — remove `:clientId` parsing/links.
- `artifacts/therassistant-inventory/src/domains/portal/PatientCheckInPage.tsx` — remove client ID and call patient-scoped RPC repository methods.
- `artifacts/therassistant-inventory/src/domains/portal/PatientJournalPage.tsx` — remove client ID and staff journal repository dependency.
- `artifacts/therassistant-inventory/src/pages/clients.tsx` — create once, then invite; no portal redirect to patient identity URL.
- `artifacts/therassistant-inventory/src/domains/patients/PatientChartPage.tsx` — replace "Open Patient Portal" with `PortalAccessPanel`.
- `scripts/check-production-auth.mjs` — stop exempting portal code and forbid legacy public portal access patterns.
- `.github/workflows/phase2-ci.yml` — update patient portal smoke routes.
- `e2e/workspace-actions.spec.ts` — add non-destructive staff portal enrollment UI coverage.

### Delete

- `artifacts/therassistant-inventory/src/lib/portal-public-client.ts` — legacy anonymous/public patient-ID client.

---

### Task 1: Add the patient identity mapping and read authorization boundary

**Files:**
- Create: `supabase/migrations/<cli-generated-version>_secure_patient_portal_auth.sql`
- Create: `artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts`

**Interfaces:**
- Produces: `public.client_portal_access`
- Produces: `private.has_client_portal_access(p_tenant_id uuid, p_client_id uuid) returns boolean`
- Produces: `public.get_my_client_portal_context() returns jsonb`
- Produces: `public.activate_my_client_portal_access() returns jsonb`
- Produces: `public.get_patient_portal_invite_context(p_client_id uuid) returns jsonb`
- Produces: `public.revoke_client_portal_access(p_client_id uuid) returns jsonb`
- Consumes: existing `private.has_tenant_read_access`, `private.has_tenant_write_access`, `clients`, `appointments`, `client_insurance_policies`, `documents`, `client_checkins`, `patient_journal_entries`, `client_balance_summaries`, `treatment_plans`, `treatment_plan_goals`, `providers`

- [ ] **Step 1: Confirm current Supabase Auth/RLS guidance before schema work**

Use the Supabase docs search for:
- `inviteUserByEmail`
- Edge Function authorization headers / `verify_jwt`
- Auth email redirect allow list
- RLS SECURITY DEFINER cautions

Also inspect Supabase changelog entries tagged as breaking changes for Auth, Edge Functions, or PostgREST since the repository's last portal migration. If a breaking change conflicts with this plan, stop and amend the spec/plan before code.

- [ ] **Step 2: Write the failing database/auth source-contract test**

Create `artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function migration(name: string) {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${name}.sql`));
  assert.ok(file, `missing migration: ${name}`);
  return readFileSync(join(dir, file), "utf8");
}

test("secure patient portal migration defines mapped identity and active-only access", () => {
  const sql = migration("secure_patient_portal_auth");
  assert.match(sql, /create table public\.client_portal_access/i);
  assert.match(sql, /references auth\.users\s*\(id\)/i);
  assert.match(sql, /private\.has_client_portal_access/i);
  assert.match(sql, /status\s*=\s*'active'/i);
  assert.match(sql, /get_my_client_portal_context/i);
  assert.match(sql, /activate_my_client_portal_access/i);
  assert.match(sql, /get_patient_portal_invite_context/i);
  assert.match(sql, /revoke_client_portal_access/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon/i);
});

test("patient read policies cover only the approved portal tables", () => {
  const sql = migration("secure_patient_portal_auth");
  for (const table of [
    "clients",
    "appointments",
    "client_insurance_policies",
    "documents",
    "client_checkins",
    "patient_journal_entries",
    "client_balance_summaries",
    "treatment_plans",
    "treatment_plan_goals",
    "providers",
  ]) {
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /on public\.clinical_notes for select to authenticated[\s\S]*has_client_portal_access/i);
  assert.doesNotMatch(sql, /on public\.professional_claims for select to authenticated[\s\S]*has_client_portal_access/i);
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts
```

Expected: FAIL because `secure_patient_portal_auth` migration does not exist.

- [ ] **Step 4: Generate the migration with the Supabase CLI**

Run:

```bash
supabase migration new secure_patient_portal_auth
```

Do not hand-invent the timestamp. Use the exact generated filename for the remainder of this task.

- [ ] **Step 5: Implement the mapping table, helper, context/activation/revoke functions, and staff policies**

Write the generated migration with this structure:

```sql
begin;

create table public.client_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null default 'self' check (relationship in ('self','guardian','proxy')),
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  invited_email citext not null,
  invited_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create unique index client_portal_access_one_live_identity_idx
  on public.client_portal_access(client_id)
  where status <> 'revoked';

create index client_portal_access_user_status_idx
  on public.client_portal_access(user_id, status);

create index client_portal_access_tenant_client_status_idx
  on public.client_portal_access(tenant_id, client_id, status);

alter table public.client_portal_access enable row level security;

create policy "client_portal_access staff select"
  on public.client_portal_access for select to authenticated
  using (private.has_tenant_read_access(tenant_id));

create policy "client_portal_access patient self select"
  on public.client_portal_access for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.has_client_portal_access(
  p_tenant_id uuid,
  p_client_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_portal_access cpa
    where cpa.tenant_id = p_tenant_id
      and cpa.client_id = p_client_id
      and cpa.user_id = (select auth.uid())
      and cpa.status = 'active'
  );
$$;

revoke all on function private.has_client_portal_access(uuid, uuid) from public, anon;
grant execute on function private.has_client_portal_access(uuid, uuid) to authenticated;

create or replace function public.get_my_client_portal_context()
returns jsonb
language sql
stable
security invoker
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'tenant_id', cpa.tenant_id,
    'client_id', cpa.client_id,
    'status', cpa.status,
    'relationship', cpa.relationship,
    'invited_email', cpa.invited_email,
    'invited_at', cpa.invited_at,
    'activated_at', cpa.activated_at,
    'revoked_at', cpa.revoked_at
  )
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
  order by
    case cpa.status when 'active' then 1 when 'invited' then 2 else 3 end,
    cpa.created_at desc
  limit 1;
$$;

revoke all on function public.get_my_client_portal_context() from public, anon;
grant execute on function public.get_my_client_portal_context() to authenticated;

create or replace function public.activate_my_client_portal_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_access
  from public.client_portal_access
  where user_id = (select auth.uid())
    and status in ('invited','active')
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Patient portal invitation is unavailable';
  end if;

  if v_email = '' or v_email <> lower(v_access.invited_email::text) then
    raise exception 'Authenticated email does not match the portal invitation';
  end if;

  if v_access.status = 'invited' then
    update public.client_portal_access
    set status = 'active',
        activated_at = coalesce(activated_at, now()),
        revoked_at = null,
        updated_at = now()
    where id = v_access.id
    returning * into v_access;
  end if;

  return jsonb_build_object(
    'tenant_id', v_access.tenant_id,
    'client_id', v_access.client_id,
    'status', v_access.status,
    'activated_at', v_access.activated_at
  );
end;
$$;

revoke all on function public.activate_my_client_portal_access() from public, anon;
grant execute on function public.activate_my_client_portal_access() to authenticated;

create or replace function public.get_patient_portal_invite_context(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_client public.clients%rowtype;
  v_access public.client_portal_access%rowtype;
begin
  select * into v_client
  from public.clients
  where id = p_client_id;

  if not found or not private.has_tenant_write_access(v_client.tenant_id) then
    raise exception 'Patient is unavailable for portal enrollment';
  end if;

  select * into v_access
  from public.client_portal_access
  where client_id = v_client.id
    and status <> 'revoked'
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'tenant_id', v_client.tenant_id,
    'client_id', v_client.id,
    'email', lower(trim(coalesce(v_client.email::text, ''))),
    'first_name', v_client.first_name,
    'last_name', v_client.last_name,
    'access_id', v_access.id,
    'access_status', v_access.status,
    'access_user_id', v_access.user_id,
    'access_invited_at', v_access.invited_at
  );
end;
$$;

revoke all on function public.get_patient_portal_invite_context(uuid) from public, anon;
grant execute on function public.get_patient_portal_invite_context(uuid) to authenticated;

create or replace function public.revoke_client_portal_access(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_access public.client_portal_access%rowtype;
begin
  select tenant_id into v_tenant_id
  from public.clients
  where id = p_client_id;

  if v_tenant_id is null or not private.has_tenant_write_access(v_tenant_id) then
    raise exception 'Patient portal access is unavailable';
  end if;

  update public.client_portal_access
  set status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  where client_id = p_client_id
    and status <> 'revoked'
  returning * into v_access;

  if v_access.id is null then
    raise exception 'No active patient portal access exists';
  end if;

  return jsonb_build_object(
    'client_id', v_access.client_id,
    'status', v_access.status,
    'revoked_at', v_access.revoked_at
  );
end;
$$;

revoke all on function public.revoke_client_portal_access(uuid) from public, anon;
grant execute on function public.revoke_client_portal_access(uuid) to authenticated;
```

Add explicit staff INSERT/UPDATE policies only if staff browser code needs direct table mutation. For this implementation it does not: invitation writes use the service client, and revocation uses the RPC. Do not add broad patient mutation policies.

- [ ] **Step 6: Add patient SELECT policies without changing existing staff policies**

Append policies like:

```sql
create policy "clients patient portal select"
  on public.clients for select to authenticated
  using (private.has_client_portal_access(tenant_id, id));

create policy "appointments patient portal select"
  on public.appointments for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "insurance patient portal select"
  on public.client_insurance_policies for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "documents patient portal select"
  on public.documents for select to authenticated
  using (
    private.has_client_portal_access(tenant_id, client_id)
    and document_type::text in (
      'insurance_card','intake_form','consent_form',
      'client_correspondence','statement','other'
    )
    and document_status::text not in ('rejected','voided')
  );

create policy "checkins patient portal select"
  on public.client_checkins for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "journal patient portal select"
  on public.patient_journal_entries for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "balances patient portal select"
  on public.client_balance_summaries for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "treatment plans patient portal select"
  on public.treatment_plans for select to authenticated
  using (private.has_client_portal_access(tenant_id, client_id));

create policy "treatment goals patient portal select"
  on public.treatment_plan_goals for select to authenticated
  using (
    exists (
      select 1
      from public.treatment_plans tp
      where tp.id = treatment_plan_goals.treatment_plan_id
        and private.has_client_portal_access(tp.tenant_id, tp.client_id)
    )
  );

create policy "providers patient portal select"
  on public.providers for select to authenticated
  using (
    exists (
      select 1
      from public.appointments a
      where a.provider_id = providers.id
        and private.has_client_portal_access(a.tenant_id, a.client_id)
    )
    or exists (
      select 1
      from public.treatment_plans tp
      where tp.provider_id = providers.id
        and private.has_client_portal_access(tp.tenant_id, tp.client_id)
    )
  );

grant select on public.client_portal_access to authenticated;
grant select on
  public.clients,
  public.appointments,
  public.client_insurance_policies,
  public.documents,
  public.client_checkins,
  public.patient_journal_entries,
  public.client_balance_summaries,
  public.treatment_plans,
  public.treatment_plan_goals,
  public.providers
to authenticated;

commit;
```

Do not add patient SELECT policies to `clinical_notes`, `professional_claims`, `denials`, `appeals`, `workqueue_items`, or credentialing tables.

- [ ] **Step 7: Run the source-contract test**

Run:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Apply the migration and verify live active/invited/revoked behavior**

Apply through the normal Supabase migration workflow. Then execute rollbackable verification using synthetic auth IDs and a synthetic client:

```sql
begin;

-- Create synthetic auth users only inside a controlled test path or use existing
-- dedicated test auth users. Set the request identity for each RLS check:
select set_config('request.jwt.claim.sub', '<test-user-uuid>', true);
select set_config('request.jwt.claim.email', 'portal-test@example.invalid', true);

-- With status='invited': own client SELECT must return 0 rows.
-- After activate_my_client_portal_access(): own client SELECT must return 1 row.
-- A different client in the same tenant must return 0 rows.
-- After revoke_client_portal_access() under a staff identity: patient SELECT must return 0 rows.

rollback;
```

Do not use production patients or send invitation email in this verification.

- [ ] **Step 9: Run Supabase advisors**

Run security and performance advisors. Fix any new issue attributable to this migration before continuing.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts
git commit -m "feat: add patient portal identity boundary"
```

---

### Task 2: Move patient writes behind patient-scoped RPCs

**Files:**
- Create: `supabase/migrations/<cli-generated-version>_secure_patient_portal_writes.sql`
- Create: `artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts`

**Interfaces:**
- Consumes: `private.has_client_portal_access(uuid, uuid)`
- Produces: `public.portal_record_checkin(p_appointment_id uuid, p_step text) returns jsonb`
- Produces: `public.portal_save_previsit_checkin(p_appointment_id uuid, p_update jsonb) returns jsonb`
- Produces: `public.portal_add_journal_entry(p_entry_text text, p_mood text, p_visibility text, p_tags text[], p_related_treatment_goal_id uuid, p_entry_status text) returns jsonb`

- [ ] **Step 1: Write the failing RPC contract test**

Create `artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function migration(name: string) {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${name}.sql`));
  assert.ok(file);
  return readFileSync(join(dir, file), "utf8");
}

test("portal writes derive authorization from auth identity", () => {
  const sql = migration("secure_patient_portal_writes");
  for (const fn of [
    "portal_record_checkin",
    "portal_save_previsit_checkin",
    "portal_add_journal_entry",
  ]) {
    assert.match(sql, new RegExp(`function public\\.${fn}`, "i"));
  }
  assert.match(sql, /private\.has_client_portal_access/i);
  assert.doesNotMatch(sql, /p_client_id\s+uuid/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon/i);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Generate the migration**

```bash
supabase migration new secure_patient_portal_writes
```

- [ ] **Step 4: Implement the check-in and previsit RPCs**

The RPCs must select the appointment first, then authorize with `private.has_client_portal_access(tenant_id, client_id)`. They never accept a client ID.

Use this shape:

```sql
create or replace function public.portal_record_checkin(
  p_appointment_id uuid,
  p_step text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_now timestamptz := now();
  v_status public.appointment_status_enum;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found
     or not private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id) then
    raise exception 'Appointment is unavailable';
  end if;

  if p_step not in ('on_my_way','arrived','checked_in') then
    raise exception 'Invalid check-in step';
  end if;

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id,
    on_my_way_at, arrived_at, checked_in_at, responses
  ) values (
    v_appt.tenant_id, v_appt.id, v_appt.client_id,
    case when p_step = 'on_my_way' then v_now end,
    case when p_step = 'arrived' then v_now end,
    case when p_step = 'checked_in' then v_now end,
    '{}'::jsonb
  )
  on conflict (appointment_id) do update set
    on_my_way_at = coalesce(public.client_checkins.on_my_way_at, excluded.on_my_way_at),
    arrived_at = coalesce(public.client_checkins.arrived_at, excluded.arrived_at),
    checked_in_at = coalesce(public.client_checkins.checked_in_at, excluded.checked_in_at),
    updated_at = now()
  returning * into v_checkin;

  v_status := case p_step
    when 'on_my_way' then 'client_on_my_way'::public.appointment_status_enum
    when 'arrived' then 'client_arrived'::public.appointment_status_enum
    else 'checked_in'::public.appointment_status_enum
  end;

  update public.appointments
  set appointment_status = v_status, updated_at = now()
  where id = v_appt.id;

  return to_jsonb(v_checkin);
end;
$$;

revoke all on function public.portal_record_checkin(uuid, text) from public, anon;
grant execute on function public.portal_record_checkin(uuid, text) to authenticated;
```

Implement `portal_save_previsit_checkin` with an explicit allow-list and server-side merge:

```sql
create or replace function public.portal_save_previsit_checkin(
  p_appointment_id uuid,
  p_update jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_previous jsonb := '{}'::jsonb;
  v_next jsonb := '{}'::jsonb;
  v_responses jsonb := '{}'::jsonb;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found
     or not private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id) then
    raise exception 'Appointment is unavailable';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_update, '{}'::jsonb)) as allowed(key)
    where allowed.key not in (
      'demographics_confirmed',
      'insurance_confirmed',
      'visit_questions',
      'consents',
      'submitted'
    )
  ) then
    raise exception 'Unsupported pre-visit field';
  end if;

  select * into v_checkin
  from public.client_checkins
  where appointment_id = v_appt.id
  limit 1;

  v_responses := coalesce(v_checkin.responses, '{}'::jsonb);
  v_previous := coalesce(v_responses -> 'pre_visit', '{}'::jsonb);
  v_next := v_previous || jsonb_build_object('updated_at', now());

  if p_update ? 'demographics_confirmed' then
    v_next := v_next || jsonb_build_object(
      'demographics_confirmed',
      (p_update ->> 'demographics_confirmed')::boolean
    );
  end if;

  if p_update ? 'insurance_confirmed' then
    v_next := v_next || jsonb_build_object(
      'insurance_confirmed',
      (p_update ->> 'insurance_confirmed')::boolean
    );
  end if;

  if p_update ? 'visit_questions' then
    if jsonb_typeof(p_update -> 'visit_questions') <> 'object' then
      raise exception 'Visit questions must be an object';
    end if;
    v_next := v_next || jsonb_build_object(
      'visit_questions',
      coalesce(v_previous -> 'visit_questions', '{}'::jsonb)
        || (p_update -> 'visit_questions')
    );
  end if;

  if p_update ? 'consents' then
    if jsonb_typeof(p_update -> 'consents') <> 'object' then
      raise exception 'Consents must be an object';
    end if;
    v_next := v_next || jsonb_build_object(
      'consents',
      coalesce(v_previous -> 'consents', '{}'::jsonb)
        || (p_update -> 'consents')
    );
  end if;

  if coalesce((p_update ->> 'submitted')::boolean, false) then
    v_next := v_next || jsonb_build_object('submitted_at', now());
  end if;

  v_responses := v_responses || jsonb_build_object('pre_visit', v_next);

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id, responses
  ) values (
    v_appt.tenant_id, v_appt.id, v_appt.client_id, v_responses
  )
  on conflict (appointment_id) do update set
    responses = excluded.responses,
    updated_at = now()
  returning * into v_checkin;

  return to_jsonb(v_checkin);
end;
$;

revoke all on function public.portal_save_previsit_checkin(uuid, jsonb) from public, anon;
grant execute on function public.portal_save_previsit_checkin(uuid, jsonb) to authenticated;
```

Only the five listed pre-visit keys are accepted; arbitrary top-level values are rejected.

- [ ] **Step 5: Implement patient journal insertion**

Use a patient-mapping lookup derived from `auth.uid()` and validate any treatment goal:

```sql
create or replace function public.portal_add_journal_entry(
  p_entry_text text,
  p_mood text default null,
  p_visibility text default 'shared_with_provider',
  p_tags jsonb default '[]'::jsonb,
  p_related_treatment_goal_id uuid default null,
  p_entry_status text default 'submitted'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_entry public.patient_journal_entries%rowtype;
begin
  select * into v_access
  from public.client_portal_access
  where user_id = (select auth.uid())
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required';
  end if;

  if nullif(trim(p_entry_text), '') is null then
    raise exception 'Journal entry text is required';
  end if;

  if p_visibility not in ('private','shared_with_provider') then
    raise exception 'Invalid journal visibility';
  end if;

  if p_entry_status not in ('draft','submitted') then
    raise exception 'Invalid journal entry status';
  end if;

  if jsonb_typeof(coalesce(p_tags, '[]'::jsonb)) <> 'array' then
    raise exception 'Journal tags must be an array';
  end if;

  if p_related_treatment_goal_id is not null and not exists (
    select 1
    from public.treatment_plan_goals tpg
    join public.treatment_plans tp on tp.id = tpg.treatment_plan_id
    where tpg.id = p_related_treatment_goal_id
      and tp.tenant_id = v_access.tenant_id
      and tp.client_id = v_access.client_id
  ) then
    raise exception 'Treatment goal is unavailable';
  end if;

  insert into public.patient_journal_entries (
    tenant_id, client_id, entry_date, entry_text, mood, author_type,
    review_status, visibility, tags, related_treatment_goal_id,
    entry_status, submitted_at
  ) values (
    v_access.tenant_id, v_access.client_id, current_date, trim(p_entry_text),
    nullif(trim(coalesce(p_mood, '')), ''), 'patient', 'unreviewed',
    p_visibility, coalesce(p_tags, '[]'::jsonb), p_related_treatment_goal_id,
    p_entry_status,
    case when p_entry_status = 'submitted' then now() else null end
  )
  returning * into v_entry;

  return to_jsonb(v_entry);
end;
$$;

revoke all on function public.portal_add_journal_entry(text, text, text, jsonb, uuid, text) from public, anon;
grant execute on function public.portal_add_journal_entry(text, text, text, jsonb, uuid, text) to authenticated;
```

- [ ] **Step 6: Explicitly avoid direct patient mutation grants**

The migration must not add patient-specific UPDATE/INSERT policies to `clients`, `appointments`, `client_checkins`, or `patient_journal_entries`. Existing staff policies remain unchanged.

- [ ] **Step 7: Run the contract test**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Apply and live-test cross-patient rejection in a transaction**

Under a test patient JWT identity:
- own appointment `portal_record_checkin` succeeds
- another patient's appointment raises `Appointment is unavailable`
- own journal insertion succeeds
- another client's treatment goal raises `Treatment goal is unavailable`
- rollback test transaction leaves no synthetic check-in/journal rows

- [ ] **Step 9: Run Supabase advisors and commit**

```bash
git add supabase/migrations artifacts/therassistant-inventory/tests/patient-portal-write-contract.test.ts
git commit -m "feat: scope patient portal writes to authenticated patient"
```

---

### Task 3: Add the trusted staff invitation Edge Function

**Files:**
- Create: `supabase/functions/invite-patient-portal/deno.json`
- Create: `supabase/functions/invite-patient-portal/logic.ts`
- Create: `supabase/functions/invite-patient-portal/index.ts`
- Create: `artifacts/therassistant-inventory/tests/patient-portal-invite.test.ts`

**Interfaces:**
- Consumes: `public.get_patient_portal_invite_context(client_id)`
- Writes: `public.client_portal_access` through service-role client only
- Produces HTTP `POST /functions/v1/invite-patient-portal`
- Request: `{ "client_id": string }`
- Success: `{ client_id, status, invited_email, invited_at }`
- Existing `active` or `invited` mapping: returns current status without creating another Auth user
- Existing Auth user without matching mapping: returns actionable 409 and does not auto-link

- [ ] **Step 1: Write failing pure-logic and source-security tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeInviteRequest,
  decideInviteAction,
} from "../../../supabase/functions/invite-patient-portal/logic.ts";

test("invite request requires a UUID-like client id", () => {
  assert.throws(() => normalizeInviteRequest({ client_id: "" }));
  assert.equal(
    normalizeInviteRequest({ client_id: "11111111-1111-4111-8111-111111111111" }).clientId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("existing live portal access is idempotent", () => {
  assert.equal(decideInviteAction("active"), "return-existing");
  assert.equal(decideInviteAction("invited"), "return-existing");
  assert.equal(decideInviteAction(null), "invite");
});

test("edge function keeps service key out of browser source", () => {
  const source = readFileSync("supabase/functions/invite-patient-portal/index.ts", "utf8");
  assert.match(source, /Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/);
  assert.match(source, /inviteUserByEmail/);
  assert.match(source, /deleteUser/);
  assert.doesNotMatch(source, /service[_-]?role[^\n]*=["'][A-Za-z0-9_.-]+["']/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run the repository test command scoped to `patient-portal-invite.test.ts`; expected FAIL because the files do not exist.

- [ ] **Step 3: Pin the Edge Function dependency**

`supabase/functions/invite-patient-portal/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.116.0"
  }
}
```

- [ ] **Step 4: Implement dependency-free decision logic**

`logic.ts`:

```ts
export type ExistingAccessStatus = "invited" | "active" | "revoked" | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeInviteRequest(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const clientId = String(row.client_id ?? "").trim();
  if (!UUID.test(clientId)) throw new Error("A valid patient ID is required.");
  return { clientId };
}

export function decideInviteAction(status: ExistingAccessStatus) {
  if (status === "active" || status === "invited") return "return-existing" as const;
  return "invite" as const;
}
```

- [ ] **Step 5: Implement the JWT-protected handler**

The handler must:
1. accept POST/OPTIONS only
2. require `Authorization: Bearer <user-jwt>`
3. use a user-scoped Supabase client to call `get_patient_portal_invite_context`
4. refuse missing patient email before Auth Admin call
5. return current `active`/`invited` access idempotently
6. use the service-role client only after staff authorization succeeds
7. call `inviteUserByEmail(email, { redirectTo, data: { first_name } })`
8. insert the mapping with `status='invited'`
9. if mapping insert fails after Auth creation, call `auth.admin.deleteUser(invitedUser.id)` as compensating cleanup, then return a 502
10. map "user already registered" to 409 without linking
11. never return service credentials

Core implementation:

```ts
import { createClient } from "@supabase/supabase-js";
import { decideInviteAction, normalizeInviteRequest } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PORTAL_BASE_URL = Deno.env.get("PORTAL_BASE_URL")!.replace(/\/$/, "");

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin === PORTAL_BASE_URL ? PORTAL_BASE_URL : "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(payload: Record<string, unknown>, status: number, req: Request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(req),
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== PORTAL_BASE_URL) {
    return json({ error: "Origin is not allowed." }, 403, req);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Authentication required" }, 401, req);
  }

  let clientId: string;
  try {
    ({ clientId } = normalizeInviteRequest(await req.json()));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400, req);
  }

  const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: context, error: contextError } = await userClient
    .rpc("get_patient_portal_invite_context", { p_client_id: clientId });

  if (contextError || !context) {
    return json({ error: "Patient is unavailable for portal enrollment." }, 403, req);
  }

  const { data: staffAuth, error: staffAuthError } = await userClient.auth.getUser();
  const staffUser = staffAuth.user;
  if (staffAuthError || !staffUser) {
    return json({ error: "Authenticated staff identity is unavailable." }, 401, req);
  }

  const email = String(context.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "Patient email is required before portal enrollment." }, 422, req);

  if (decideInviteAction(context.access_status ?? null) === "return-existing") {
    return json({
      client_id: clientId,
      status: context.access_status,
      invited_email: email,
      invited_at: context.access_invited_at ?? null,
    }, 200, req);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const redirectTo = `${PORTAL_BASE_URL.replace(/\/$/, "")}/patient-portal/activate`;
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { first_name: context.first_name ?? null },
  });

  if (inviteError || !invited.user) {
    const duplicate = /already|registered|exists/i.test(inviteError?.message ?? "");
    return json({
      error: duplicate
        ? "An Auth account already exists for this email. It was not linked automatically."
        : (inviteError?.message ?? "Unable to send patient portal invitation."),
    }, duplicate ? 409 : 502, req);
  }

  const invitedAt = new Date().toISOString();
  const { error: mappingError } = await admin.from("client_portal_access").insert({
    tenant_id: context.tenant_id,
    client_id: clientId,
    user_id: invited.user.id,
    relationship: "self",
    status: "invited",
    invited_email: email,
    invited_at: invitedAt,
    created_by: staffUser.id,
  });

  if (mappingError) {
    await admin.auth.admin.deleteUser(invited.user.id).catch(() => undefined);
    return json({ error: "Invitation could not be linked to the patient. No portal access was created." }, 502, req);
  }

  return json({
    client_id: clientId,
    status: "invited",
    invited_email: email,
    invited_at: invitedAt,
  }, 201, req);
});
```

The handler obtains `staffUser.id` from `userClient.auth.getUser()`; it never decodes an unverified token for authorization or audit identity.

CORS must allow only `PORTAL_BASE_URL` as the browser origin. Reject other origins for non-OPTIONS requests.

- [ ] **Step 6: Run tests**

Expected: pure logic tests PASS; source-security test PASS.

- [ ] **Step 7: Deploy to a non-production test target or local Edge runtime first**

Deploy with JWT verification enabled. Configure `PORTAL_BASE_URL` to the canonical frontend origin.

Verify:
- no Authorization header -> 401
- staff JWT + nonexistent client -> 403/404 path before invite
- read-only staff -> forbidden before invite
- missing patient email -> 422 before invite

Do not invoke the success path with a production patient during automated verification.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/invite-patient-portal artifacts/therassistant-inventory/tests/patient-portal-invite.test.ts
git commit -m "feat: add secure patient portal invitation service"
```

---

### Task 4: Put patient portal routes behind Auth and add activation/login/recovery

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/routes.ts`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalGate.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalLoginPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalActivatePage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalRecoveryPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/lib/supabase-client.ts`
- Modify: `artifacts/therassistant-inventory/src/auth/auth-context.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Extend test: `artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts`

**Interfaces:**
- Produces route constants: `PORTAL_HOME`, `PORTAL_LOGIN`, `PORTAL_ACTIVATE`, `PORTAL_RECOVER`, `portalCheckInPath(appointmentId)`
- Produces Auth session `flowType: "invite" | "recovery" | null`
- Produces `requestPasswordRecovery(email, redirectTo?)`
- Produces `updatePasswordForCurrentSession(password, allowedFlow)`
- Consumes `get_my_client_portal_context()` and `activate_my_client_portal_access()`

- [ ] **Step 1: Extend the failing route/auth contract**

Add assertions:

```ts
test("patient portal routes contain no client id authority", () => {
  const app = readFileSync("artifacts/therassistant-inventory/src/App.tsx", "utf8");
  assert.doesNotMatch(app, /patient-portal\/:clientId/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /PatientPortalGate/);
});
```

Do not delete the public client yet; this test should fail first.

- [ ] **Step 2: Add route constants**

`routes.ts`:

```ts
export const PORTAL_HOME = "/patient-portal";
export const PORTAL_LOGIN = "/patient-portal/login";
export const PORTAL_ACTIVATE = "/patient-portal/activate";
export const PORTAL_RECOVER = "/patient-portal/recover";
export const PORTAL_JOURNAL = "/patient-portal/journal";

export function portalCheckInPath(appointmentId: string) {
  return `/patient-portal/check-in/${encodeURIComponent(appointmentId)}`;
}

export function isPatientPortalPath(pathname: string) {
  return pathname === PORTAL_HOME || pathname.startsWith("/patient-portal/");
}
```

- [ ] **Step 3: Preserve Auth flow type from invite/recovery URLs**

Change `AuthSession` from a recovery-only marker to:

```ts
export type AuthFlowType = "invite" | "recovery" | null;

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  flowType?: AuthFlowType;
  user: AuthUser;
};
```

In `sessionFromUrl()`:

```ts
const rawType = params.get("type");
const flowType: AuthFlowType =
  rawType === "invite" || rawType === "recovery" ? rawType : null;
```

Persist `flowType` through refresh. Keep `passwordRecovery` in AuthContext as a derived compatibility field:

```ts
passwordRecovery: session?.flowType === "recovery"
```

Add:

```ts
export async function updatePasswordForCurrentSession(
  password: string,
  allowedFlow: "invite" | "recovery",
) {
  const session = await getSession();
  if (!session?.access_token || session.flowType !== allowedFlow) {
    throw new Error("A valid authentication flow is required.");
  }
  // existing PUT /auth/v1/user password update
}
```

For recovery, change the request helper to accept a redirect:

```ts
export async function requestPasswordRecovery(email: string, redirectTo?: string) {
  const suffix = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  await authRequest(`/auth/v1/recover${suffix}`, { email });
}
```

- [ ] **Step 4: Make AuthProvider wrap both staff and patient surfaces**

Refactor `App.tsx` to:

```tsx
export default function App() {
  return (
    <AuthProvider>
      <ApplicationRoutes />
    </AuthProvider>
  );
}

function ApplicationRoutes() {
  const [location] = useLocation();
  return isPatientPortalPath(location) ? <PatientPortalRoutes /> : <StaffGate />;
}
```

Portal routes:

```tsx
function PatientPortalRoutes() {
  return (
    <Switch>
      <Route path={PORTAL_LOGIN}><PatientPortalLoginPage /></Route>
      <Route path={PORTAL_ACTIVATE}><PatientPortalActivatePage /></Route>
      <Route path={PORTAL_RECOVER}><PatientPortalRecoveryPage /></Route>
      <PatientPortalGate>
        <Switch>
          <Route path="/patient-portal/check-in/:appointmentId"><PatientCheckInPage /></Route>
          <Route path={PORTAL_JOURNAL}><PatientJournalPage /></Route>
          <Route path={PORTAL_HOME}><PatientPortalPage /></Route>
          <Route><div className="thera-state">Patient portal page not found.</div></Route>
        </Switch>
      </PatientPortalGate>
    </Switch>
  );
}
```

If Wouter nesting makes the child placement invalid, keep the same semantics with a small `PatientAuthenticatedRoutes` component; do not reintroduce `:clientId`.

- [ ] **Step 5: Implement patient gate behavior**

`PatientPortalGate` logic:

```tsx
const { session, loading, signOut } = useAuth();

if (loading) return <div className="thera-state">Checking patient portal session...</div>;
if (!session) return <Redirect to={PORTAL_LOGIN} />;

const context = await getMyPortalContext();

if (!context) return <AccessUnavailable onSignOut={signOut} />;
if (context.status === "invited") return <Redirect to={PORTAL_ACTIVATE} />;
if (context.status !== "active") return <AccessUnavailable onSignOut={signOut} />;

return <PortalContextProvider value={context}>{children}</PortalContextProvider>;
```

Create a small React context in the same file or a focused `portal-context.tsx` if the gate file becomes unwieldy. Child pages may read `clientId` only from this authenticated context, never from the route.

- [ ] **Step 6: Implement patient login, activation, and recovery pages**

Patient login:
- email/password
- "Forgot password?" calls `requestPasswordReset(email, `${window.location.origin}${PORTAL_RECOVER}`)`
- successful login navigates to `PORTAL_HOME`

Activation:
- require `session.flowType === "invite"`
- enforce 12-character minimum matching existing staff recovery rule
- call `updatePasswordForCurrentSession(password, "invite")`
- call `activate_my_client_portal_access` before signing out
- because the existing password helper signs out, split the low-level password update from the staff recovery "update then logout" wrapper; activation must remain authenticated long enough to activate the mapping
- after activation, retain/refetch the authenticated session and navigate home

Recovery:
- require `flowType === "recovery"`
- update password
- sign out
- navigate to patient login

Do not reuse the staff `PasswordRecoveryPage` directly because its post-reset destination is the staff login surface.

- [ ] **Step 7: Run auth contract and typecheck**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS for all Task 4 route/auth assertions.

- [ ] **Step 8: Commit**

```bash
git add artifacts/therassistant-inventory/src/App.tsx artifacts/therassistant-inventory/src/auth artifacts/therassistant-inventory/src/lib/supabase-client.ts artifacts/therassistant-inventory/src/domains/portal artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts
git commit -m "feat: gate patient portal with Supabase Auth"
```

---

### Task 5: Replace the public patient-ID data client with authenticated patient-scoped data access

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/portal-client.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/repository.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientCheckInPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientJournalPage.tsx`
- Modify: `artifacts/therassistant-inventory/tests/patient-portal.test.ts`
- Delete: `artifacts/therassistant-inventory/src/lib/portal-public-client.ts`

**Interfaces:**
- Produces: `portalSelect<T>(table, filters)`
- Produces: `portalRpc<T>(functionName, args)`
- Produces: `getMyPortalContext()`
- Changes: `getPatientPortalData()` takes no patient ID
- Changes: `recordCheckIn(appointmentId, step)` takes no patient ID
- Changes: `savePreVisitCheckIn(appointmentId, update)` takes no patient ID
- Changes: `addPortalJournalEntry(input)` takes no patient ID

- [ ] **Step 1: Add failing source assertions**

In `patient-portal-auth-contract.test.ts`:

```ts
for (const file of [
  "PatientPortalPage.tsx",
  "PatientCheckInPage.tsx",
  "PatientJournalPage.tsx",
]) {
  const source = readFileSync(
    `artifacts/therassistant-inventory/src/domains/portal/${file}`,
    "utf8",
  );
  assert.doesNotMatch(source, /clientId/);
  assert.doesNotMatch(source, /\/patient-portal\/\$\{clientId\}/);
}

assert.equal(
  existsSync("artifacts/therassistant-inventory/src/lib/portal-public-client.ts"),
  false,
);
```

Expected: FAIL against current pages.

- [ ] **Step 2: Create authenticated portal client**

`portal-client.ts`:

```ts
import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";

export type PortalRow = Record<string, unknown>;

async function request<T>(label: string, url: URL, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`Patient portal ${label} request failed (${response.status})${payload ? `: ${payload}` : ""}`);
  }
  return payload ? JSON.parse(payload) as T : undefined as T;
}

export async function portalSelect<T extends PortalRow>(
  table: string,
  filters: Record<string, string> = {},
) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return request<T[]>(table, url);
}

export function portalRpc<T>(functionName: string, args: PortalRow = {}) {
  return request<T>(
    `rpc/${functionName}`,
    new URL(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`),
    { method: "POST", body: JSON.stringify(args) },
  );
}
```

- [ ] **Step 3: Refactor portal repository**

```ts
export type PortalContext = {
  tenant_id: string;
  client_id: string;
  status: "invited" | "active" | "revoked";
  relationship: string;
  invited_email: string;
};

export function getMyPortalContext() {
  return portalRpc<PortalContext | null>("get_my_client_portal_context");
}

export function recordCheckIn(
  appointmentId: string,
  step: CheckInStep,
) {
  return portalRpc<DataRow>("portal_record_checkin", {
    p_appointment_id: appointmentId,
    p_step: step,
  });
}

export function savePreVisitCheckIn(
  appointmentId: string,
  update: PreVisitCheckInUpdate,
) {
  return portalRpc<DataRow>("portal_save_previsit_checkin", {
    p_appointment_id: appointmentId,
    p_update: update,
  });
}

export function addPortalJournalEntry(input: JournalEntryInput) {
  const values = buildJournalEntryValues(input);
  return portalRpc<DataRow>("portal_add_journal_entry", {
    p_entry_text: values.entry_text,
    p_mood: values.mood,
    p_visibility: values.visibility,
    p_tags: values.tags,
    p_related_treatment_goal_id: values.related_treatment_goal_id,
    p_entry_status: values.entry_status,
  });
}
```

`getPatientPortalData()`:
1. call `getMyPortalContext()`
2. require `status === "active"`
3. use `context.client_id` only as a server-authorized filter optimization
4. issue SELECTs using `portalSelect`
5. rely on RLS as the authorization boundary

- [ ] **Step 4: Remove patient ID from all portal components and links**

Examples:

```tsx
<Link href={PORTAL_HOME}>Home</Link>
<Link href={PORTAL_JOURNAL}>Journal</Link>
<Link href={portalCheckInPath(appointment.id)}>Start Pre-Visit Check-In</Link>
```

`PatientCheckInPage` route reads only `appointmentId`.

`PatientJournalPage` calls:

```ts
await addPortalJournalEntry({
  entryText,
  mood,
  visibility,
  tags: symptoms,
  relatedTreatmentGoalId: goalId || undefined,
  entryStatus,
});
```

Remove its import from `../journal/repository`; the staff journal repository remains unchanged for staff Patient 360.

- [ ] **Step 5: Delete the legacy public client**

Delete:
`artifacts/therassistant-inventory/src/lib/portal-public-client.ts`

- [ ] **Step 6: Run portal unit/contract tests and typecheck**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal*.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal artifacts/therassistant-inventory/src/lib/portal-public-client.ts artifacts/therassistant-inventory/tests
git commit -m "feat: scope portal data to authenticated patient"
```

---

### Task 6: Make staff enrollment create once, invite once, and expose portal status/revocation

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/staff-portal-access.ts`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PortalAccessPanel.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/patients/create-patient-with-portal.ts`
- Create: `artifacts/therassistant-inventory/tests/patient-portal-enrollment.test.ts`
- Modify: `artifacts/therassistant-inventory/src/pages/clients.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/patients/PatientChartPage.tsx`

**Interfaces:**
- Produces: `invitePatientPortal(clientId)`
- Produces: `getClientPortalAccess(clientId)`
- Produces: `revokeClientPortalAccess(clientId)`
- Produces: `createPatientWithOptionalPortal({ createPatient, invitePortal, enrollPortal })`

- [ ] **Step 1: Write the create-once regression tests**

`patient-portal-enrollment.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createPatientWithOptionalPortal } from "../src/domains/patients/create-patient-with-portal.ts";

test("portal invitation failure does not recreate the patient", async () => {
  let creates = 0;
  let invites = 0;

  const result = await createPatientWithOptionalPortal({
    enrollPortal: true,
    createPatient: async () => {
      creates += 1;
      return { id: "patient-1" };
    },
    invitePortal: async () => {
      invites += 1;
      throw new Error("SMTP unavailable");
    },
  });

  assert.equal(creates, 1);
  assert.equal(invites, 1);
  assert.equal(result.patient.id, "patient-1");
  assert.match(result.portalError ?? "", /SMTP unavailable/);
});

test("save-only never calls invitation service", async () => {
  let invites = 0;
  await createPatientWithOptionalPortal({
    enrollPortal: false,
    createPatient: async () => ({ id: "patient-2" }),
    invitePortal: async () => { invites += 1; return {} as never; },
  });
  assert.equal(invites, 0);
});
```

- [ ] **Step 2: Run and verify failure**

Expected: FAIL because the orchestration module does not exist.

- [ ] **Step 3: Implement create-once orchestration**

```ts
export async function createPatientWithOptionalPortal<TPatient extends { id: string }, TInvite>({
  enrollPortal,
  createPatient,
  invitePortal,
}: {
  enrollPortal: boolean;
  createPatient: () => Promise<TPatient>;
  invitePortal: (clientId: string) => Promise<TInvite>;
}) {
  const patient = await createPatient();

  if (!enrollPortal) {
    return { patient, portalInvitation: null as TInvite | null, portalError: null as string | null };
  }

  try {
    const portalInvitation = await invitePortal(patient.id);
    return { patient, portalInvitation, portalError: null as string | null };
  } catch (error) {
    return {
      patient,
      portalInvitation: null as TInvite | null,
      portalError: error instanceof Error ? error.message : "Unable to send patient portal invitation.",
    };
  }
}
```

- [ ] **Step 4: Implement staff portal-access client**

`staff-portal-access.ts`:

```ts
import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { tenantRpc, tenantSelect, type Row } from "../../lib/tenant-data-client";

export type ClientPortalAccess = Row & {
  id: string;
  client_id: string;
  status: "invited" | "active" | "revoked";
  invited_email: string;
  invited_at?: string | null;
  activated_at?: string | null;
  revoked_at?: string | null;
};

export async function getClientPortalAccess(clientId: string) {
  const rows = await tenantSelect<ClientPortalAccess>("client_portal_access", {
    client_id: `eq.${clientId}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function invitePatientPortal(clientId: string) {
  const response = await authenticatedFetch(
    `${SUPABASE_URL}/functions/v1/invite-patient-portal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    },
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "Unable to send patient portal invitation."));
  return payload;
}

export function revokeClientPortalAccess(clientId: string) {
  return tenantRpc("revoke_client_portal_access", { p_client_id: clientId });
}
```

- [ ] **Step 5: Refactor Add Patient flow**

In `clients.tsx`:
- pass `p_portal_enrolled: false` to `create_patient_intake` in all cases; metadata is no longer authoritative
- use `createPatientWithOptionalPortal`
- after patient creation, always close the drawer and refresh the list
- if invitation fails, show a page-level error containing a Patient 360 link; never leave the new-patient drawer open
- if invitation succeeds, show a page-level success message
- do not navigate to `/patient-portal/<id>`

Pseudo-implementation:

```ts
const result = await createPatientWithOptionalPortal({
  enrollPortal,
  createPatient: () => tenantRpc<CreatedRow>("create_patient_intake", {
    ...intakeArgs,
    p_portal_enrolled: false,
  }),
  invitePortal: invitePatientPortal,
});

closeForm();
setVersion((value) => value + 1);

if (result.portalError) {
  setPageNotice({
    kind: "error",
    message: `Patient saved, but portal invitation failed: ${result.portalError}`,
    patientId: result.patient.id,
  });
} else if (enrollPortal) {
  setPageNotice({
    kind: "success",
    message: "Patient saved and portal invitation sent.",
    patientId: result.patient.id,
  });
}
```

Update drawer copy from "save the patient and open their portal immediately" to "save the patient and send their secure portal invitation."

- [ ] **Step 6: Replace staff "Open Patient Portal" with Portal Access panel**

Implement `PortalAccessPanel` with explicit load/action states:

```tsx
export function PortalAccessPanel({ clientId }: { clientId: string }) {
  const [access, setAccess] = useState<ClientPortalAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"invite" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAccess(await getClientPortalAccess(clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load portal access.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [clientId]);

  async function invite() {
    setWorking("invite");
    setError(null);
    try {
      await invitePatientPortal(clientId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send portal invitation.");
    } finally {
      setWorking(null);
    }
  }

  async function revoke() {
    setWorking("revoke");
    setError(null);
    try {
      await revokeClientPortalAccess(clientId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to revoke portal access.");
    } finally {
      setWorking(null);
    }
  }

  if (loading) return <section className="thera-card"><h2>Patient Portal</h2><p>Loading portal access...</p></section>;

  return (
    <section className="thera-card">
      <h2>Patient Portal</h2>
      {error && <div className="thera-state error">{error}</div>}
      {!access && (
        <>
          <p>Status: Not enrolled</p>
          <button className="thera-action" type="button" disabled={working !== null} onClick={() => void invite()}>
            {working === "invite" ? "Sending..." : "Send Portal Invite"}
          </button>
        </>
      )}
      {access?.status === "invited" && (
        <p>Invitation pending for {access.invited_email}.</p>
      )}
      {access?.status === "active" && (
        <>
          <p>Portal active for {access.invited_email}.</p>
          <button className="thera-action secondary" type="button" disabled={working !== null} onClick={() => void revoke()}>
            {working === "revoke" ? "Revoking..." : "Revoke Portal Access"}
          </button>
        </>
      )}
      {access?.status === "revoked" && (
        <p>Portal access was revoked. Automatic relinking is not available in this release.</p>
      )}
    </section>
  );
}
```

The component never renders a direct link into the patient portal because a staff session is not a patient identity.

Modify `PatientChartPage`:

```tsx
{tab === "portal" && (
  <div className="thera-detail-grid">
    <PortalAccessPanel clientId={patientId} />
    <Table title="Check-In History" rows={chart.checkins} ... />
  </div>
)}
```

- [ ] **Step 7: Run enrollment test and typecheck**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-portal-enrollment.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/therassistant-inventory/src/pages/clients.tsx artifacts/therassistant-inventory/src/domains/patients artifacts/therassistant-inventory/src/domains/portal artifacts/therassistant-inventory/tests/patient-portal-enrollment.test.ts
git commit -m "feat: connect staff patient enrollment to secure portal invites"
```

---

### Task 7: Harden CI contracts and browser coverage

**Files:**
- Modify: `scripts/check-production-auth.mjs`
- Modify: `.github/workflows/phase2-ci.yml`
- Modify: `e2e/workspace-actions.spec.ts`
- Extend: `artifacts/therassistant-inventory/tests/patient-portal-auth-contract.test.ts`

**Interfaces:**
- CI forbids legacy patient-ID/public portal authority.
- Browser E2E remains non-destructive unless a dedicated safe test patient/invite environment is explicitly configured.

- [ ] **Step 1: Make production auth contract inspect portal code**

Remove:

```js
if (rel.includes('/domains/portal/')) continue;
```

Add forbidden patterns:

```js
const portalForbidden = [
  ['legacy portal public client', /portal-public-client/],
  ['patient id portal route', /patient-portal\/:clientId/],
  ['patient id portal link', /\/patient-portal\/\$\{clientId\}/],
];

for (const file of walk(srcRoot)) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  for (const [label, pattern] of [...forbidden, ...portalForbidden]) {
    if (pattern.test(text)) failures.push(`${rel}: forbidden production auth marker: ${label}`);
  }
}
```

Keep the existing browser secret scan.

- [ ] **Step 2: Update Phase 2 SPA smoke routes**

Replace the old client-ID portal route:

```yaml
routes=(
  "/"
  "/clients"
  "/clients/ff648f71-9c94-433c-9aab-f80b039a80fd"
  "/eligibility"
  "/authorizations"
  "/schedule"
  "/schedule/55000000-0000-4000-8000-000000000006"
  "/patient-portal/login"
  "/patient-portal/activate"
  "/patient-portal"
  "/encounters/56000000-0000-4000-8000-000000000001"
)
```

This is an HTTP shell smoke test only; it does not assert authenticated content.

- [ ] **Step 3: Add non-destructive browser assertions**

Extend `workspace-actions.spec.ts` so the Add Patient drawer:
- still shows Enroll in Patient Portal
- copy says invitation is sent, not portal is opened
- cancel does not invoke any Edge Function

Also add a public route test in a separate E2E file if necessary:

```ts
test("patient portal home requires a patient session", async ({ page }) => {
  await page.goto("/patient-portal");
  await expect(page.getByRole("heading", { name: /patient portal sign in/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/patient-portal/login");
});
```

Do not create a real Auth invite in baseline CI.

- [ ] **Step 4: Run all local gates**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
node scripts/check-production-auth.mjs
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: all PASS.

- [ ] **Step 5: Run browser secret scan explicitly**

```bash
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then
  echo "Forbidden Supabase server secret marker found in browser source."
  exit 1
fi
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-production-auth.mjs .github/workflows/phase2-ci.yml e2e artifacts/therassistant-inventory/tests
git commit -m "test: enforce secure patient portal auth contract"
```

---

### Task 8: Deploy, verify isolation, review, and merge

**Files:**
- No new application files unless verification exposes a defect.
- Deployment/configuration: Supabase Auth redirect allow list, Edge Function secret `PORTAL_BASE_URL`, Vercel production.

**Interfaces:**
- Production frontend origin must be the same origin configured in `PORTAL_BASE_URL`.
- Supabase Auth redirect allow list must include:
  - `<production-origin>/patient-portal/activate`
  - `<production-origin>/patient-portal/recover`

- [ ] **Step 1: Identify the canonical Vercel production origin**

Use the connected Vercel project/deployment data. Use the stable production alias/custom domain, not a commit-specific preview URL.

Record that exact origin as the `PORTAL_BASE_URL` Edge Function secret.

- [ ] **Step 2: Configure Supabase Auth redirects**

In hosted Supabase Auth URL configuration, add the exact activation and recovery URLs above. Do not use a wildcard broader than the application needs.

- [ ] **Step 3: Deploy database migrations**

Verify migration history after deployment and ensure the repository migration filenames match the versions recorded by Supabase.

- [ ] **Step 4: Deploy `invite-patient-portal`**

Deploy with `verify_jwt=true`.

Confirm the deployed function contains the pinned `@supabase/supabase-js@2.116.0` import map and can read `PORTAL_BASE_URL`.

- [ ] **Step 5: Run live RLS isolation tests without production patient data**

Use dedicated synthetic test users/client rows and rollback/cleanup:
- patient A active mapping can read client A
- patient A cannot read client B in same tenant
- patient A cannot read another tenant
- invited mapping reads no client data
- revoked mapping reads no client data
- own appointment check-in RPC works
- other patient's appointment fails
- own journal insert works
- protected direct UPDATE is denied

Delete any synthetic Auth users created for this test after verification.

- [ ] **Step 6: Perform one controlled invitation smoke test only with an approved test email**

This is not an automated CI action.

Verify:
1. authorized staff sends invite
2. email arrives
3. invite opens `/patient-portal/activate`
4. patient sets 12+ character password
5. mapping becomes active
6. patient reaches `/patient-portal`
7. journal/check-in operate
8. patient cannot alter URL/API filters to see another patient
9. staff revocation immediately blocks patient data even if the Auth session still exists

If no approved test mailbox is available, skip the email-send smoke and document that only non-email functional verification was completed; do not use a real patient's email.

- [ ] **Step 7: Run Supabase advisors again**

Security advisor: no new unresolved issue caused by this feature.

Performance advisor: review new policy/index warnings; fix portal-specific warnings before merge.

- [ ] **Step 8: Push branch and open PR**

PR title:

`Secure patient portal authentication and enrollment`

PR body must summarize:
- dedicated patient Auth mapping
- patient-specific RLS
- narrow patient write RPCs
- secure staff invite Edge Function
- client-ID-free portal routes
- create-once enrollment error handling
- tests and live isolation verification

- [ ] **Step 9: Require all CI phases and Vercel preview to pass**

Verify:
- Phase 2 CI success
- Phase 3 CI success
- Phase 4 CI success
- Phase 5 CI success
- browser E2E success
- production auth contract success
- browser secret scan success
- Vercel preview READY

- [ ] **Step 10: Request code review and resolve findings**

Request the configured automated review. For any security/auth/RLS feedback, use the `superpowers:receiving-code-review` workflow before editing.

- [ ] **Step 11: Final verification before merge**

Use the `superpowers:verification-before-completion` skill.

Re-check:
- no `:clientId` patient portal routes
- no `portal-public-client.ts`
- no browser secret markers
- Edge Function `verify_jwt=true`
- active-only patient helper
- invite failure never reruns patient creation
- all CI green on unchanged head

- [ ] **Step 12: Squash merge and verify production deployment**

Merge only the unchanged reviewed head. After merge:
- verify PR state is merged
- verify production Vercel deployment is READY
- verify Supabase migrations/functions correspond to merged repository state
- perform a non-destructive `/patient-portal/login` production route smoke check
