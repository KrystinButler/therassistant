create table if not exists public.coding_guidance_sheet_rows (
  source_version text not null,
  sheet_name text not null,
  row_number integer not null check (row_number > 0),
  cells jsonb not null,
  source_name text not null,
  loaded_at timestamptz not null default now(),
  primary key (source_version, sheet_name, row_number)
);

create index if not exists coding_guidance_sheet_rows_sheet_idx
  on public.coding_guidance_sheet_rows (sheet_name, source_version, row_number);

alter table public.coding_guidance_sheet_rows enable row level security;

drop policy if exists authenticated_reference_read on public.coding_guidance_sheet_rows;
create policy authenticated_reference_read
  on public.coding_guidance_sheet_rows
  for select
  to authenticated
  using (true);

create or replace function public.get_coding_guidance_sheet(
  p_sheet_name text,
  p_source_version text default null
)
returns table(
  source_version text,
  sheet_name text,
  row_number integer,
  cells jsonb,
  source_name text
)
language sql
stable
set search_path to 'public','extensions'
as $function$
  select
    r.source_version,
    r.sheet_name,
    r.row_number,
    r.cells,
    r.source_name
  from public.coding_guidance_sheet_rows r
  where upper(r.sheet_name)=upper(trim(p_sheet_name))
    and (p_source_version is null or r.source_version=p_source_version)
  order by r.source_version desc, r.row_number;
$function$;
