create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.has_tenant_read_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id = tu.tenant_id
     and tur.user_id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.status = 'active'::public.user_status_enum
      and tur.role <> 'client'::public.system_role_enum
  );
$$;

create or replace function private.has_tenant_write_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id = tu.tenant_id
     and tur.user_id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.status = 'active'::public.user_status_enum
      and tur.role not in (
        'client'::public.system_role_enum,
        'read_only'::public.system_role_enum
      )
  );
$$;

revoke all on function private.has_tenant_read_access(uuid) from public;
revoke all on function private.has_tenant_write_access(uuid) from public;
revoke all on function private.has_tenant_read_access(uuid) from anon;
revoke all on function private.has_tenant_write_access(uuid) from anon;
grant execute on function private.has_tenant_read_access(uuid) to authenticated;
grant execute on function private.has_tenant_write_access(uuid) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and policyname ~ ' tenant (select|insert|update)$'
  loop
    if r.cmd = 'SELECT' then
      execute format(
        'alter policy %I on public.%I using (private.has_tenant_read_access(tenant_id))',
        r.policyname,
        r.tablename
      );
    elsif r.cmd = 'INSERT' then
      execute format(
        'alter policy %I on public.%I with check (private.has_tenant_write_access(tenant_id))',
        r.policyname,
        r.tablename
      );
    elsif r.cmd = 'UPDATE' then
      execute format(
        'alter policy %I on public.%I using (private.has_tenant_write_access(tenant_id)) with check (private.has_tenant_write_access(tenant_id))',
        r.policyname,
        r.tablename
      );
    end if;
  end loop;
end
$$;

drop function if exists public.has_tenant_read_access(uuid);
drop function if exists public.has_tenant_write_access(uuid);
