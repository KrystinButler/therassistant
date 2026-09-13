-- Browser write permissions for the synthetic Therassistant Demo payment workflow only.
-- No DELETE privileges are granted and all writes remain tenant-isolated by RLS.

grant insert on table public.payment_allocations to anon;
grant insert on table public.adjustments to anon;
grant insert on table public.adjustment_allocations to anon;
grant insert, update on table public.era_files to anon;
grant insert on table public.era_claims to anon;
grant insert on table public.era_matches to anon;

drop policy if exists "demo anon payment allocations insert" on public.payment_allocations;
create policy "demo anon payment allocations insert"
on public.payment_allocations
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon adjustments insert" on public.adjustments;
create policy "demo anon adjustments insert"
on public.adjustments
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon adjustment allocations insert" on public.adjustment_allocations;
create policy "demo anon adjustment allocations insert"
on public.adjustment_allocations
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon era files insert" on public.era_files;
create policy "demo anon era files insert"
on public.era_files
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon era files update" on public.era_files;
create policy "demo anon era files update"
on public.era_files
for update
to anon
using (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
)
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon era claims insert" on public.era_claims;
create policy "demo anon era claims insert"
on public.era_claims
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon era matches insert" on public.era_matches;
create policy "demo anon era matches insert"
on public.era_matches
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);
