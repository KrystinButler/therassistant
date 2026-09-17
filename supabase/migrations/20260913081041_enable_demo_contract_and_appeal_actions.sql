do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payer_contracts' and policyname='demo anon payer contracts write') then
    create policy "demo anon payer contracts write" on public.payer_contracts for all to anon using (exists (select 1 from public.tenants t where t.id = payer_contracts.tenant_id and coalesce((t.settings->>'demo')::boolean,false))) with check (exists (select 1 from public.tenants t where t.id = payer_contracts.tenant_id and coalesce((t.settings->>'demo')::boolean,false)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='appeals' and policyname='demo anon appeals write') then
    create policy "demo anon appeals write" on public.appeals for all to anon using (exists (select 1 from public.tenants t where t.id = appeals.tenant_id and coalesce((t.settings->>'demo')::boolean,false))) with check (exists (select 1 from public.tenants t where t.id = appeals.tenant_id and coalesce((t.settings->>'demo')::boolean,false)));
  end if;
end $$;
grant select, insert, update on public.payer_contracts to anon;
grant select, insert, update on public.appeals to anon;
