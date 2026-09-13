-- Browser write permissions for the synthetic Therassistant Demo workflow only.
-- These policies do not grant DELETE and do not expose non-demo tenant rows.

grant insert on table public.professional_claim_lines to anon;
grant insert on table public.claim_diagnoses to anon;
grant insert on table public.claim_status_history to anon;
grant insert, update on table public.claim_batches to anon;
grant insert on table public.claim_batch_items to anon;
grant insert, update on table public.claim_submissions to anon;
grant insert on table public.submission_responses to anon;

drop policy if exists "demo anon claim lines insert" on public.professional_claim_lines;
create policy "demo anon claim lines insert"
on public.professional_claim_lines
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim diagnoses insert" on public.claim_diagnoses;
create policy "demo anon claim diagnoses insert"
on public.claim_diagnoses
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim history insert" on public.claim_status_history;
create policy "demo anon claim history insert"
on public.claim_status_history
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim batches insert" on public.claim_batches;
create policy "demo anon claim batches insert"
on public.claim_batches
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim batches update" on public.claim_batches;
create policy "demo anon claim batches update"
on public.claim_batches
for update
to anon
using (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
)
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim batch items insert" on public.claim_batch_items;
create policy "demo anon claim batch items insert"
on public.claim_batch_items
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim submissions insert" on public.claim_submissions;
create policy "demo anon claim submissions insert"
on public.claim_submissions
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon claim submissions update" on public.claim_submissions;
create policy "demo anon claim submissions update"
on public.claim_submissions
for update
to anon
using (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
)
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);

drop policy if exists "demo anon submission responses insert" on public.submission_responses;
create policy "demo anon submission responses insert"
on public.submission_responses
for insert
to anon
with check (
  tenant_id in (select id from public.tenants where name = 'Therassistant Demo')
);
