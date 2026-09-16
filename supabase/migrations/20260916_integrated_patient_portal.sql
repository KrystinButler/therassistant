begin;

alter table public.patient_journal_entries
  add column if not exists visibility text not null default 'shared_with_provider',
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists related_treatment_goal_id uuid references public.treatment_plan_goals(id),
  add column if not exists entry_status text not null default 'submitted',
  add column if not exists submitted_at timestamptz;

update public.patient_journal_entries
set
  visibility = coalesce(nullif(visibility, ''), 'shared_with_provider'),
  entry_status = coalesce(nullif(entry_status, ''), 'submitted'),
  submitted_at = case
    when coalesce(nullif(entry_status, ''), 'submitted') = 'submitted'
      then coalesce(submitted_at, created_at)
    else submitted_at
  end;

alter table public.patient_journal_entries
  drop constraint if exists patient_journal_entries_visibility_check;
alter table public.patient_journal_entries
  add constraint patient_journal_entries_visibility_check
  check (visibility in ('private', 'shared_with_provider'));

alter table public.patient_journal_entries
  drop constraint if exists patient_journal_entries_entry_status_check;
alter table public.patient_journal_entries
  add constraint patient_journal_entries_entry_status_check
  check (entry_status in ('draft', 'submitted'));

create index if not exists patient_journal_entries_visibility_idx
  on public.patient_journal_entries(tenant_id, client_id, entry_status, visibility, entry_date desc);

create table if not exists public.patient_payment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_monthly_amount_cents bigint,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'cancelled', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requested_monthly_amount_cents is null or requested_monthly_amount_cents > 0)
);

create index if not exists patient_payment_plans_client_idx
  on public.patient_payment_plans(tenant_id, client_id, status, created_at desc);

create table if not exists public.portal_balance_exception_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portal_balance_exception_requests_client_idx
  on public.portal_balance_exception_requests(tenant_id, client_id, status, created_at desc);

update public.tenants
set settings = coalesce(settings, '{}'::jsonb)
  || '{"portal_balance_threshold_cents":20000}'::jsonb
where coalesce((settings->>'demo')::boolean, false) = true;

alter table public.patient_payment_plans enable row level security;
alter table public.portal_balance_exception_requests enable row level security;

drop policy if exists "demo anon read patient payment plans integrated portal" on public.patient_payment_plans;
create policy "demo anon read patient payment plans integrated portal"
  on public.patient_payment_plans for select to anon
  using (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

drop policy if exists "demo anon insert patient payment plans integrated portal" on public.patient_payment_plans;
create policy "demo anon insert patient payment plans integrated portal"
  on public.patient_payment_plans for insert to anon
  with check (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

drop policy if exists "demo anon update patient payment plans integrated portal" on public.patient_payment_plans;
create policy "demo anon update patient payment plans integrated portal"
  on public.patient_payment_plans for update to anon
  using (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ))
  with check (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

drop policy if exists "demo anon read balance exceptions integrated portal" on public.portal_balance_exception_requests;
create policy "demo anon read balance exceptions integrated portal"
  on public.portal_balance_exception_requests for select to anon
  using (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

drop policy if exists "demo anon insert balance exceptions integrated portal" on public.portal_balance_exception_requests;
create policy "demo anon insert balance exceptions integrated portal"
  on public.portal_balance_exception_requests for insert to anon
  with check (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

drop policy if exists "demo anon update balance exceptions integrated portal" on public.portal_balance_exception_requests;
create policy "demo anon update balance exceptions integrated portal"
  on public.portal_balance_exception_requests for update to anon
  using (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ))
  with check (tenant_id in (
    select id from public.tenants
    where coalesce((settings->>'demo')::boolean, false) = true
  ));

grant select, insert, update on public.patient_payment_plans to anon;
grant select, insert, update on public.portal_balance_exception_requests to anon;

revoke delete, truncate, references, trigger on public.patient_payment_plans from anon;
revoke delete, truncate, references, trigger on public.portal_balance_exception_requests from anon;

commit;
