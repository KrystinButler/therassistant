-- Consolidate account/profile lifecycle and tenant admin role semantics.

-- 1) Repair any auth users that are missing their one-to-one profile.
insert into public.user_profiles (id, first_name, last_name, display_name, email)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'first_name', ''),
  nullif(u.raw_user_meta_data ->> 'last_name', ''),
  coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(trim(concat_ws(' ', u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name')), ''),
    u.email
  ),
  u.email
from auth.users u
left join public.user_profiles up on up.id = u.id
where up.id is null;

-- 2) Make auth.users the single creation source for user_profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.user_profiles (id, first_name, last_name, display_name, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(trim(concat_ws(' ', new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name')), ''),
      new.email
    ),
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- 3) Keep the profile email synchronized from Auth when the login email changes.
create or replace function public.sync_auth_user_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.user_profiles
  set email = new.email,
      updated_at = now()
  where id = new.id;

  return new;
end;
$function$;

revoke all on function public.sync_auth_user_profile_email() from public, anon, authenticated;
grant execute on function public.sync_auth_user_profile_email() to supabase_auth_admin;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_auth_user_profile_email();

-- 4) Prevent application-level profile email edits from diverging from auth.users.
create or replace function public.enforce_user_profile_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_email text;
begin
  select u.email into v_auth_email
  from auth.users u
  where u.id = new.id;

  if not found then
    raise exception 'User profile must correspond to an Auth user';
  end if;

  if new.email::text is distinct from v_auth_email then
    raise exception 'Profile email is managed by the authenticated account';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_user_profile_auth_email() from public, anon;
grant execute on function public.enforce_user_profile_auth_email() to authenticated, service_role, supabase_auth_admin;

drop trigger if exists enforce_user_profile_auth_email on public.user_profiles;
create trigger enforce_user_profile_auth_email
before insert or update of email on public.user_profiles
for each row
execute function public.enforce_user_profile_auth_email();

-- 5) Remove the alternate manual profile-creation workflow.
drop policy if exists "users can insert own profile" on public.user_profiles;
revoke insert, delete, truncate, trigger, references on public.user_profiles from authenticated;

-- 6) Tenant bootstrap now creates only tenant membership/role state.
--    p_email is retained in the signature for API compatibility but is no longer a profile source.
create or replace function public.bootstrap_tenant_for_user(
  p_tenant_name text,
  p_tenant_type public.tenant_type_enum default 'billing_company'::public.tenant_type_enum,
  p_timezone text default 'America/Denver'::text,
  p_email text default null::text,
  p_display_name text default null::text
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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

  if not exists (
    select 1
    from public.user_profiles
    where id = v_user_id
  ) then
    raise exception 'User profile is not initialized';
  end if;

  -- Preserve display-name onboarding behavior without allowing bootstrap
  -- to create profiles or own the canonical login email.
  if nullif(trim(p_display_name), '') is not null then
    update public.user_profiles
    set display_name = trim(p_display_name),
        updated_at = now()
    where id = v_user_id;
  end if;

  if p_tenant_type = 'billing_company'::public.tenant_type_enum then
    v_role := 'billing_company_admin'::public.system_role_enum;
  else
    v_role := 'practice_admin'::public.system_role_enum;
  end if;

  insert into public.tenants (name, tenant_type, timezone, status, created_by)
  values (
    trim(p_tenant_name),
    p_tenant_type,
    coalesce(nullif(trim(p_timezone), ''), 'America/Denver'),
    'pending_setup'::public.tenant_status_enum,
    v_user_id
  )
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
$function$;

-- 7) Remove currently redundant paired admin roles while preserving the role
--    appropriate to the tenant type.
delete from public.tenant_user_roles tur
using public.tenants t
where t.id = tur.tenant_id
  and t.tenant_type = 'billing_company'::public.tenant_type_enum
  and tur.role = 'practice_admin'::public.system_role_enum
  and exists (
    select 1
    from public.tenant_user_roles canonical
    where canonical.tenant_id = tur.tenant_id
      and canonical.user_id = tur.user_id
      and canonical.role = 'billing_company_admin'::public.system_role_enum
  );

delete from public.tenant_user_roles tur
using public.tenants t
where t.id = tur.tenant_id
  and t.tenant_type = 'practice'::public.tenant_type_enum
  and tur.role = 'billing_company_admin'::public.system_role_enum
  and exists (
    select 1
    from public.tenant_user_roles canonical
    where canonical.tenant_id = tur.tenant_id
      and canonical.user_id = tur.user_id
      and canonical.role = 'practice_admin'::public.system_role_enum
  );

-- 8) Ensure creator self-assignment uses the admin role matching the tenant type.
drop policy if exists "tenant creators can add own admin role" on public.tenant_user_roles;
create policy "tenant creators can add own admin role"
on public.tenant_user_roles
as permissive
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants t
    where t.id = tenant_user_roles.tenant_id
      and t.created_by = (select auth.uid())
      and (
        (t.tenant_type = 'billing_company'::public.tenant_type_enum
          and tenant_user_roles.role = 'billing_company_admin'::public.system_role_enum)
        or
        (t.tenant_type = 'practice'::public.tenant_type_enum
          and tenant_user_roles.role = 'practice_admin'::public.system_role_enum)
        or
        (t.tenant_type not in ('practice'::public.tenant_type_enum, 'billing_company'::public.tenant_type_enum)
          and tenant_user_roles.role = any(array[
            'practice_admin'::public.system_role_enum,
            'billing_company_admin'::public.system_role_enum
          ]))
      )
  )
);

-- 9) Admin role changes use one canonical role per practice/billing-company tenant.
create or replace function private.set_tenant_user_roles_impl(
  p_tenant_id uuid,
  p_user_id uuid,
  p_roles text[]
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
  v_admin_count integer;
  v_tenant_type public.tenant_type_enum;
begin
  if not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;

  if p_roles is null or cardinality(p_roles)=0 then
    raise exception 'At least one role is required';
  end if;

  if not exists (
    select 1 from public.tenant_users
    where tenant_id=p_tenant_id and user_id=p_user_id
  ) then
    raise exception 'Tenant user not found';
  end if;

  select t.tenant_type into v_tenant_type
  from public.tenants t
  where t.id = p_tenant_id;

  if v_tenant_type is null then
    raise exception 'Tenant not found';
  end if;

  foreach v_role in array p_roles loop
    if v_role not in (
      'platform_admin','practice_admin','billing_company_admin','billing_manager',
      'biller','clinician','front_desk','credentialing_specialist','read_only','client'
    ) then
      raise exception 'Unsupported role: %', v_role;
    end if;
  end loop;

  if v_tenant_type = 'billing_company'::public.tenant_type_enum
     and 'practice_admin' = any(p_roles) then
    raise exception 'practice_admin is not valid for a billing-company tenant; use billing_company_admin';
  end if;

  if v_tenant_type = 'practice'::public.tenant_type_enum
     and 'billing_company_admin' = any(p_roles) then
    raise exception 'billing_company_admin is not valid for a practice tenant; use practice_admin';
  end if;

  if p_user_id=(select auth.uid())
     and not (p_roles && array['platform_admin','practice_admin','billing_company_admin']) then
    select count(distinct tu.user_id)
      into v_admin_count
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id=tu.tenant_id and tur.user_id=tu.user_id
    where tu.tenant_id=p_tenant_id
      and tu.status::text='active'
      and tu.user_id<>p_user_id
      and tur.role::text in ('platform_admin','practice_admin','billing_company_admin');

    if v_admin_count=0 then
      raise exception 'The last active administrator cannot remove their own administrative role';
    end if;
  end if;

  delete from public.tenant_user_roles
  where tenant_id=p_tenant_id and user_id=p_user_id;

  insert into public.tenant_user_roles (tenant_id,user_id,role)
  select p_tenant_id,p_user_id,role_text::public.system_role_enum
  from (
    select distinct unnest(p_roles) as role_text
  ) normalized_roles;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, new_values, metadata
  ) values (
    p_tenant_id,(select auth.uid()),'tenant_user_roles_updated','tenant_user',p_user_id::text,
    jsonb_build_object('roles',to_jsonb(p_roles)),
    '{}'::jsonb
  );

  return jsonb_build_object('user_id',p_user_id,'roles',to_jsonb(p_roles));
end;
$function$;
