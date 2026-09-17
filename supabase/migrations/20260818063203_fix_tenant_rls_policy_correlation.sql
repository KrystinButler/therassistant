do $$
declare
  r record;
  row_tenant_ref text;
  membership_predicate text;
begin
  for r in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tenant_id'
      and table_name not in ('tenant_users', 'tenant_user_roles')
    order by table_name
  loop
    row_tenant_ref := format('%I.%I.tenant_id', r.table_schema, r.table_name);
    membership_predicate := format(
      'exists (
         select 1
         from public.tenant_users tu
         where tu.tenant_id = %s
           and tu.user_id = (select auth.uid())
           and tu.status = ''active''::public.user_status_enum
       )',
      row_tenant_ref
    );

    execute format('drop policy if exists %I on %I.%I', r.table_name || ' tenant select', r.table_schema, r.table_name);
    execute format('drop policy if exists %I on %I.%I', r.table_name || ' tenant insert', r.table_schema, r.table_name);
    execute format('drop policy if exists %I on %I.%I', r.table_name || ' tenant update', r.table_schema, r.table_name);
    execute format('drop policy if exists %I on %I.%I', r.table_name || ' tenant delete', r.table_schema, r.table_name);

    execute format(
      'create policy %I on %I.%I for select to authenticated using (%s)',
      r.table_name || ' tenant select', r.table_schema, r.table_name, membership_predicate
    );

    execute format(
      'create policy %I on %I.%I for insert to authenticated with check (%s)',
      r.table_name || ' tenant insert', r.table_schema, r.table_name, membership_predicate
    );

    execute format(
      'create policy %I on %I.%I for update to authenticated using (%s) with check (%s)',
      r.table_name || ' tenant update', r.table_schema, r.table_name, membership_predicate, membership_predicate
    );
  end loop;
end $$;
