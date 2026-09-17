begin;

drop policy if exists "demo anon insert authorizations phase2" on public.authorizations;
create policy "demo anon insert authorizations phase2"
  on public.authorizations for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update authorizations phase2" on public.authorizations;
create policy "demo anon update authorizations phase2"
  on public.authorizations for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon insert authorization units phase2" on public.authorization_units;
create policy "demo anon insert authorization units phase2"
  on public.authorization_units for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update authorization units phase2" on public.authorization_units;
create policy "demo anon update authorization units phase2"
  on public.authorization_units for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

grant insert, update on public.authorizations to anon;
grant insert, update on public.authorization_units to anon;
revoke delete, truncate, references, trigger on public.authorizations from anon;
revoke delete, truncate, references, trigger on public.authorization_units from anon;

commit;
