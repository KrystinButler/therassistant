create table if not exists public.reference_fee_rate_sources (
  source_version text primary key,
  source_name text not null,
  source_note text null,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.reference_fee_rates (
  source_version text not null references public.reference_fee_rate_sources(source_version) on delete cascade,
  payer_label text not null,
  payer_id uuid null references public.payers(id),
  provider_level text not null,
  code text not null,
  modifier text not null default '',
  rate_cents bigint not null check (rate_cents >= 0),
  effective_from date null,
  effective_to date null,
  loaded_at timestamptz not null default now(),
  primary key (source_version, payer_label, provider_level, code, modifier)
);

create index if not exists reference_fee_rates_code_idx
  on public.reference_fee_rates (code, provider_level);
create index if not exists reference_fee_rates_payer_idx
  on public.reference_fee_rates (payer_id, provider_level, code);

alter table public.reference_fee_rate_sources enable row level security;
alter table public.reference_fee_rates enable row level security;

drop policy if exists authenticated_reference_read on public.reference_fee_rate_sources;
create policy authenticated_reference_read
  on public.reference_fee_rate_sources
  for select to authenticated using (true);

drop policy if exists authenticated_reference_read on public.reference_fee_rates;
create policy authenticated_reference_read
  on public.reference_fee_rates
  for select to authenticated using (true);

create or replace view public.v_reference_fee_rates
with (security_invoker = true)
as
select
  r.source_version,
  r.payer_label,
  r.payer_id,
  p.name as payer_name,
  r.provider_level,
  r.code,
  nullif(r.modifier,'') as modifier,
  r.rate_cents,
  (r.rate_cents::numeric / 100.0) as rate_dollars,
  r.effective_from,
  r.effective_to,
  s.source_name,
  s.source_note
from public.reference_fee_rates r
join public.reference_fee_rate_sources s on s.source_version=r.source_version
left join public.payers p on p.id=r.payer_id;
