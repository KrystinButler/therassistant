alter table public.tenants
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists idx_tenants_created_by on public.tenants(created_by);

-- Tenants need a creator path for first-account setup, plus the normal member read/update path.
drop policy if exists "members can read tenants" on public.tenants;
drop policy if exists "members or creator can read tenants" on public.tenants;
drop policy if exists "authenticated users can create tenants" on public.tenants;
drop policy if exists "creator or members can update tenants" on public.tenants;

create policy "members or creator can read tenants"
on public.tenants
for select
to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenants.id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
  )
);

create policy "authenticated users can create tenants"
on public.tenants
for insert
to authenticated
with check (
  created_by = (select auth.uid())
);

create policy "creator or members can update tenants"
on public.tenants
for update
to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenants.id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
  )
)
with check (
  created_by = (select auth.uid())
  or exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenants.id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
  )
);

-- User profile self-service policies.
alter table public.user_profiles enable row level security;

drop policy if exists "users can read own profile" on public.user_profiles;
drop policy if exists "users can insert own profile" on public.user_profiles;
drop policy if exists "users can update own profile" on public.user_profiles;

create policy "users can read own profile"
on public.user_profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy "users can insert own profile"
on public.user_profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy "users can update own profile"
on public.user_profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- First tenant membership and role can only be created by the same user who just created the tenant.
drop policy if exists "tenant creators can add own membership" on public.tenant_users;
drop policy if exists "users can update own tenant memberships" on public.tenant_users;

create policy "tenant creators can add own membership"
on public.tenant_users
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants t
    where t.id = tenant_users.tenant_id
      and t.created_by = (select auth.uid())
  )
);

create policy "users can update own tenant memberships"
on public.tenant_users
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "tenant creators can add own admin role" on public.tenant_user_roles;

create policy "tenant creators can add own admin role"
on public.tenant_user_roles
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role in ('practice_admin'::public.system_role_enum, 'billing_company_admin'::public.system_role_enum)
  and exists (
    select 1
    from public.tenants t
    where t.id = tenant_user_roles.tenant_id
      and t.created_by = (select auth.uid())
  )
);

create or replace function public.bootstrap_tenant_for_user(
  p_tenant_name text,
  p_tenant_type public.tenant_type_enum default 'billing_company'::public.tenant_type_enum,
  p_timezone text default 'America/Denver',
  p_email text default null,
  p_display_name text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_role public.system_role_enum;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required';
  end if;

  if nullif(trim(p_tenant_name), '') is null then
    raise exception 'Tenant name is required';
  end if;

  if p_tenant_type = 'billing_company'::public.tenant_type_enum then
    v_role := 'billing_company_admin'::public.system_role_enum;
  else
    v_role := 'practice_admin'::public.system_role_enum;
  end if;

  insert into public.user_profiles (id, email, display_name)
  values (v_user_id, nullif(trim(p_email), ''), nullif(trim(p_display_name), ''))
  on conflict (id) do update set
    email = coalesce(excluded.email, public.user_profiles.email),
    display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
    updated_at = now();

  insert into public.tenants (name, tenant_type, timezone, status, created_by)
  values (trim(p_tenant_name), p_tenant_type, coalesce(nullif(trim(p_timezone), ''), 'America/Denver'), 'pending_setup'::public.tenant_status_enum, v_user_id)
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, status, joined_at)
  values (v_tenant_id, v_user_id, 'active'::public.user_status_enum, now())
  on conflict do nothing;

  insert into public.tenant_user_roles (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, v_role)
  on conflict do nothing;

  update public.tenants
  set status = 'active'::public.tenant_status_enum,
      updated_at = now()
  where id = v_tenant_id;

  return v_tenant_id;
end;
$$;

revoke execute on function public.bootstrap_tenant_for_user(text, public.tenant_type_enum, text, text, text) from public, anon;
grant execute on function public.bootstrap_tenant_for_user(text, public.tenant_type_enum, text, text, text) to authenticated;
