begin;

create table if not exists public.patient_journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  entry_date date not null default current_date,
  entry_text text not null,
  mood text,
  author_type text not null default 'patient' check (author_type in ('patient','caregiver')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','reviewed','flagged')),
  reviewed_at timestamptz,
  reviewed_by_provider_id uuid references public.providers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_journal_entries_client_idx
  on public.patient_journal_entries(tenant_id, client_id, entry_date desc);

alter table public.patient_journal_entries enable row level security;

drop policy if exists "demo anon read patient journal phase2" on public.patient_journal_entries;
create policy "demo anon read patient journal phase2"
  on public.patient_journal_entries for select to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon insert patient journal phase2" on public.patient_journal_entries;
create policy "demo anon insert patient journal phase2"
  on public.patient_journal_entries for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update patient journal phase2" on public.patient_journal_entries;
create policy "demo anon update patient journal phase2"
  on public.patient_journal_entries for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon insert checkins phase2" on public.client_checkins;
create policy "demo anon insert checkins phase2"
  on public.client_checkins for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update checkins phase2" on public.client_checkins;
create policy "demo anon update checkins phase2"
  on public.client_checkins for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon insert documents phase2" on public.documents;
create policy "demo anon insert documents phase2"
  on public.documents for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

grant select, insert, update on public.patient_journal_entries to anon;
grant insert, update on public.client_checkins to anon;
grant insert on public.documents to anon;

revoke delete, truncate, references, trigger on public.patient_journal_entries from anon;
revoke delete, truncate, references, trigger on public.client_checkins from anon;
revoke delete, update, truncate, references, trigger on public.documents from anon;

commit;
