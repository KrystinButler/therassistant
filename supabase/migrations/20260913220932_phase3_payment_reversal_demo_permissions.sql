grant insert on table public.payment_reversals to anon;
grant update on table public.payment_allocations to anon;

drop policy if exists "demo anon payment reversals insert" on public.payment_reversals;
create policy "demo anon payment reversals insert"
on public.payment_reversals
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon payment allocations update" on public.payment_allocations;
create policy "demo anon payment allocations update"
on public.payment_allocations
for update
to anon
using (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
)
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);
