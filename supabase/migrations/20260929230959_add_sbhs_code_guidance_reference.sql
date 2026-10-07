create table if not exists public.sbhs_code_guidance (
  source_version text not null,
  code text not null,
  base_code text not null,
  modifier text null,
  code_system text not null check (code_system in ('CPT','HCPCS')),
  description text null,
  minutes text null,
  example_services text null,
  notes text null,
  service_providers jsonb not null default '[]'::jsonb,
  place_of_service jsonb not null default '[]'::jsonb,
  provider_types jsonb not null default '[]'::jsonb,
  effective_from date not null,
  effective_to date null,
  source_name text not null,
  extraction_scope text not null,
  loaded_at timestamptz not null default now(),
  primary key (source_version, code)
);

create index if not exists sbhs_code_guidance_base_code_idx
  on public.sbhs_code_guidance (base_code, code_system, effective_from);

alter table public.sbhs_code_guidance enable row level security;

drop policy if exists authenticated_reference_read on public.sbhs_code_guidance;
create policy authenticated_reference_read
  on public.sbhs_code_guidance
  for select
  to authenticated
  using (true);
