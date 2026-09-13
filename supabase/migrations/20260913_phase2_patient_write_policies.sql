begin;

drop policy if exists "demo anon insert client contacts" on public.client_contacts;
create policy "demo anon insert client contacts"
  on public.client_contacts for insert to anon
  with check (
    tenant_id in (
      select id from public.tenants where name = 'Therassistant Demo'
    )
  );

drop policy if exists "demo anon update client contacts" on public.client_contacts;
create policy "demo anon update client contacts"
  on public.client_contacts for update to anon
  using (
    tenant_id in (
      select id from public.tenants where name = 'Therassistant Demo'
    )
  )
  with check (
    tenant_id in (
      select id from public.tenants where name = 'Therassistant Demo'
    )
  );

grant insert, update on public.client_contacts to anon;
revoke delete, truncate, references, trigger on public.client_contacts from anon;

commit;
