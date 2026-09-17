begin;

drop policy if exists "demo anon insert insurance policies" on public.client_insurance_policies;
create policy "demo anon insert insurance policies"
  on public.client_insurance_policies for insert to anon
  with check (
    tenant_id in (
      select id from public.tenants where name = 'Therassistant Demo'
    )
  );

drop policy if exists "demo anon update insurance policies" on public.client_insurance_policies;
create policy "demo anon update insurance policies"
  on public.client_insurance_policies for update to anon
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

grant insert, update on public.client_insurance_policies to anon;
revoke delete, truncate, references, trigger on public.client_insurance_policies from anon;

commit;
