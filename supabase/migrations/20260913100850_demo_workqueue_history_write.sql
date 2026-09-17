-- Allow the browser-only synthetic demo to persist Work Center audit history.
-- No DELETE privileges are granted and writes remain scoped to Therassistant Demo.

grant insert on table public.workqueue_history to anon;

drop policy if exists "demo anon work history insert" on public.workqueue_history;
create policy "demo anon work history insert"
on public.workqueue_history
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);
