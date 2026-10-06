-- Connect CPT/HCPCS fee schedules and revenue-cycle service lines to the canonical code library.
-- This migration is intentionally additive/non-destructive: existing text code columns remain
-- the API-compatible keys while foreign keys prevent future drift.

-- reference_fee_rates exists in production but is optional in clean/replayed environments.
-- Guard all work against that table so the migration can be applied from a fresh database.
do $$
begin
  if to_regclass('public.reference_fee_rates') is not null then
    insert into public.cpt_codes (
      code,
      display_name,
      is_active,
      label_source,
      metadata
    )
    select distinct
      upper(trim(r.code)) as code,
      upper(trim(r.code)) as display_name,
      true as is_active,
      'reference_fee_rate_backfill' as label_source,
      jsonb_build_object(
        'code_system', 'CPT_HCPCS',
        'backfilled_from', 'reference_fee_rates'
      ) as metadata
    from public.reference_fee_rates r
    where nullif(trim(r.code), '') is not null
      and not exists (
        select 1
        from public.cpt_codes c
        where c.code = upper(trim(r.code))
      );

    update public.reference_fee_rates
    set code = upper(trim(code))
    where code is distinct from upper(trim(code));

    if not exists (select 1 from pg_constraint where conname = 'reference_fee_rates_code_fkey') then
      alter table public.reference_fee_rates
        add constraint reference_fee_rates_code_fkey
        foreign key (code) references public.cpt_codes(code)
        on update cascade on delete restrict;
    end if;

    create index if not exists idx_reference_fee_rates_code
      on public.reference_fee_rates(code);
  end if;
end
$$;

-- cpt_codes is the compatibility parent for all procedure-code foreign keys. Keep every HCPCS
-- key searchable from the national library represented there as a canonical parent row, while
-- retaining HCPCS descriptions/versioning in hcpcs_codes as the authoritative search source.
insert into public.cpt_codes (
  code,
  display_name,
  is_active,
  label_source,
  official_description,
  official_description_source,
  metadata
)
select distinct on (upper(trim(h.code)))
  upper(trim(h.code)) as code,
  coalesce(nullif(trim(h.long_description), ''), nullif(trim(h.short_description), ''), upper(trim(h.code))) as display_name,
  true as is_active,
  'hcpcs_reference_sync' as label_source,
  coalesce(nullif(trim(h.long_description), ''), nullif(trim(h.short_description), '')) as official_description,
  'CMS HCPCS' as official_description_source,
  jsonb_build_object(
    'code_system', 'HCPCS',
    'source_version', h.version,
    'backfilled_from', 'hcpcs_codes'
  ) as metadata
from public.hcpcs_codes h
where nullif(trim(h.code), '') is not null
order by upper(trim(h.code)), h.effective_from desc, h.version desc
on conflict (code) do nothing;

-- Prevent HCPCS compatibility-parent rows from appearing as duplicate CPT search results.
create or replace function public.search_procedure_codes(
  p_search text,
  p_service_date date default current_date,
  p_limit integer default 20
)
returns table (
  code text,
  name text,
  system text,
  version text,
  effective_from date,
  effective_to date,
  description_source text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with candidates as (
    select
      c.code,
      c.display_name as name,
      'CPT'::text as system,
      null::text as version,
      c.effective_from,
      c.effective_to,
      c.label_source as description_source,
      case
        when c.code = upper(trim(coalesce(p_search,''))) then 0
        when c.code ilike upper(trim(coalesce(p_search,''))) || '%' then 1
        else 3
      end as rank
    from public.cpt_codes c
    where c.is_active
      and coalesce(c.metadata ->> 'code_system', 'CPT') <> 'HCPCS'
      and (c.effective_from is null or c.effective_from <= coalesce(p_service_date,current_date))
      and (c.effective_to is null or c.effective_to >= coalesce(p_service_date,current_date))
      and (
        c.code ilike upper(trim(coalesce(p_search,''))) || '%'
        or c.display_name ilike '%' || trim(coalesce(p_search,'')) || '%'
      )
    union all
    select
      h.code,
      coalesce(h.long_description, h.short_description, h.code) as name,
      'HCPCS'::text as system,
      h.version,
      h.effective_from,
      h.effective_to,
      'CMS'::text as description_source,
      case
        when h.code = upper(trim(coalesce(p_search,''))) then 0
        when h.code ilike upper(trim(coalesce(p_search,''))) || '%' then 1
        else 3
      end as rank
    from public.hcpcs_codes h
    where h.effective_from <= coalesce(p_service_date,current_date)
      and (h.effective_to is null or h.effective_to >= coalesce(p_service_date,current_date))
      and (
        h.code ilike upper(trim(coalesce(p_search,''))) || '%'
        or coalesce(h.short_description,'') ilike '%' || trim(coalesce(p_search,'')) || '%'
        or coalesce(h.long_description,'') ilike '%' || trim(coalesce(p_search,'')) || '%'
      )
  )
  select code, name, system, version, effective_from, effective_to, description_source
  from candidates
  order by rank, code
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

-- Normalize existing fee schedule code keys before enforcing relationships.
update public.fee_schedule_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is distinct from upper(trim(cpt_code));

-- Revenue-cycle workflow tables use the same canonical code key.
update public.appointments
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.clinical_notes
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.encounter_service_lines
set cpt_hcpcs_code = upper(trim(cpt_hcpcs_code))
where cpt_hcpcs_code is not null
  and cpt_hcpcs_code is distinct from upper(trim(cpt_hcpcs_code));

update public.charge_capture_items
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.professional_claim_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.eligibility_benefits
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.era_service_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

-- Enforce one canonical CPT/HCPCS vocabulary across fee schedules and the revenue cycle.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fee_schedule_lines_cpt_code_fkey') then
    alter table public.fee_schedule_lines
      add constraint fee_schedule_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'appointments_cpt_code_fkey') then
    alter table public.appointments
      add constraint appointments_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clinical_notes_cpt_code_fkey') then
    alter table public.clinical_notes
      add constraint clinical_notes_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'encounter_service_lines_cpt_hcpcs_code_fkey') then
    alter table public.encounter_service_lines
      add constraint encounter_service_lines_cpt_hcpcs_code_fkey
      foreign key (cpt_hcpcs_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'charge_capture_items_cpt_code_fkey') then
    alter table public.charge_capture_items
      add constraint charge_capture_items_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'professional_claim_lines_cpt_code_fkey') then
    alter table public.professional_claim_lines
      add constraint professional_claim_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'eligibility_benefits_cpt_code_fkey') then
    alter table public.eligibility_benefits
      add constraint eligibility_benefits_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'era_service_lines_cpt_code_fkey') then
    alter table public.era_service_lines
      add constraint era_service_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;
end
$$;

-- Index the fee-rate lookup key used by pricing and reimbursement comparison paths.
create index if not exists idx_fee_schedule_lines_cpt_code
  on public.fee_schedule_lines(cpt_code);
