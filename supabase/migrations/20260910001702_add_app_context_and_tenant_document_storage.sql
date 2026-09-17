-- Application bootstrap context for the authenticated front end.
create or replace function public.get_app_context()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, auth
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile jsonb;
  v_tenants jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'id', up.id,
    'email', up.email,
    'display_name', up.display_name,
    'first_name', up.first_name,
    'last_name', up.last_name,
    'phone', up.phone,
    'status', up.status
  )
  into v_profile
  from public.user_profiles up
  where up.id = v_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tenant_id', t.id,
        'tenant_name', t.name,
        'tenant_type', t.tenant_type,
        'tenant_status', t.status,
        'timezone', t.timezone,
        'membership_status', tu.status,
        'roles', coalesce(
          (
            select jsonb_agg(tur.role order by tur.role::text)
            from public.tenant_user_roles tur
            where tur.tenant_id = t.id
              and tur.user_id = v_user_id
          ),
          '[]'::jsonb
        )
      )
      order by t.name
    ),
    '[]'::jsonb
  )
  into v_tenants
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  where tu.user_id = v_user_id
    and tu.status = 'active'::public.user_status_enum
    and t.status in ('active'::public.tenant_status_enum, 'pending_setup'::public.tenant_status_enum);

  return jsonb_build_object(
    'user_id', v_user_id,
    'profile', coalesce(v_profile, jsonb_build_object('id', v_user_id, 'email', (select auth.jwt()->>'email'))),
    'tenants', v_tenants
  );
end;
$$;

revoke all on function public.get_app_context() from public;
revoke all on function public.get_app_context() from anon;
grant execute on function public.get_app_context() to authenticated, service_role;

-- Private tenant-scoped document bucket policies.
-- Object paths must start with the tenant UUID: <tenant_id>/...
drop policy if exists "Tenant members can read documents" on storage.objects;
drop policy if exists "Tenant members can upload documents" on storage.objects;
drop policy if exists "Tenant members can update documents" on storage.objects;
drop policy if exists "Tenant members can delete documents" on storage.objects;

create policy "Tenant members can read documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
      and tu.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy "Tenant members can upload documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
      and tu.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy "Tenant members can update documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
      and tu.tenant_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
      and tu.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy "Tenant members can delete documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'::public.user_status_enum
      and tu.tenant_id::text = (storage.foldername(name))[1]
  )
);
