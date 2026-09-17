drop policy if exists demo_anon_read on public.authorizations;
create policy demo_anon_read on public.authorizations for select to anon using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
