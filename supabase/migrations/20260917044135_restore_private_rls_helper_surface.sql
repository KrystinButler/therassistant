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