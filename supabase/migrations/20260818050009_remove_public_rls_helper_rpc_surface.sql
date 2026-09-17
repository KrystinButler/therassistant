DO $$
declare
  r record;
  membership_predicate text := 'exists (select 1 from public.tenant_users tu where tu.tenant_id = tenant_id and tu.user_id = (select auth.uid()) and tu.status = ''active'')';
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and c.table_name not in ('tenant_users','tenant_user_roles','tenants','audit_logs','system_events','phi_access_logs','payers','payer_plans','payer_aliases')
  loop
    execute format('alter policy %I on %I.%I using (%s)', r.table_name || ' tenant select', r.table_schema, r.table_name, membership_predicate);
    execute format('alter policy %I on %I.%I with check (%s)', r.table_name || ' tenant insert', r.table_schema, r.table_name, membership_predicate);
    execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.table_name || ' tenant update', r.table_schema, r.table_name, membership_predicate, membership_predicate);
  end loop;
end $$;

alter policy "members can read billing company links"
on public.billing_company_practice_links
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.user_id = (select auth.uid())
      and tu.status = 'active'
      and tu.tenant_id in (billing_company_tenant_id, practice_tenant_id)
  )
);

alter policy "members can read audit logs"
on public.audit_logs
using (
  tenant_id is not null and exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = audit_logs.tenant_id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'
  )
);

alter policy "members can read system events"
on public.system_events
using (
  tenant_id is not null and exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = system_events.tenant_id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'
  )
);

alter policy "members can read phi access logs"
on public.phi_access_logs
using (
  tenant_id is not null and exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = phi_access_logs.tenant_id
      and tu.user_id = (select auth.uid())
      and tu.status = 'active'
  )
);

revoke execute on function public.is_tenant_member(uuid) from public, anon, authenticated;
revoke execute on function public.has_tenant_role(uuid, system_role_enum) from public, anon, authenticated;
drop function public.is_tenant_member(uuid);
drop function public.has_tenant_role(uuid, system_role_enum);
