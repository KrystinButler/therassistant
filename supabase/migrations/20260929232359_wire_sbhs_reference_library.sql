create or replace view public.reference_library_status as
select 'ICD-10-CM'::text as library,
       count(*) as row_count,
       max(icd10_codes.loaded_at) as last_loaded_at
from public.icd10_codes
union all
select 'HCPCS Level II (loaded datasets)'::text,
       count(*),
       max(hcpcs_codes.loaded_at)
from public.hcpcs_codes
union all
select 'CPT (internal labels / licensed descriptions when available)'::text,
       count(*),
       max(cpt_codes.updated_at)
from public.cpt_codes
union all
select 'Place of Service'::text,
       count(*),
       max(place_of_service_codes.updated_at)
from public.place_of_service_codes
union all
select 'Modifiers'::text,
       count(*),
       null::timestamptz
from public.code_modifiers
union all
select 'NCCI PTP'::text,
       count(*),
       max(ncci_ptp_edits.loaded_at)
from public.ncci_ptp_edits
union all
select 'MUE'::text,
       count(*),
       max(mue_limits.loaded_at)
from public.mue_limits
union all
select 'Medicare RVU'::text,
       count(*),
       max(rvu_rates.loaded_at)
from public.rvu_rates
union all
select 'Colorado SBHS code guidance'::text,
       count(*),
       max(sbhs_code_guidance.loaded_at)
from public.sbhs_code_guidance;

create or replace function public.search_procedure_codes(
  p_search text,
  p_service_date date default current_date,
  p_limit integer default 20
)
returns table(
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
set search_path to 'public','extensions'
as $function$
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
      h.source_name as description_source,
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
$function$;

create or replace function public.get_sbhs_code_guidance(
  p_code text,
  p_service_date date default current_date
)
returns table(
  source_version text,
  code text,
  base_code text,
  modifier text,
  code_system text,
  description text,
  minutes text,
  example_services text,
  notes text,
  service_providers jsonb,
  place_of_service jsonb,
  provider_types jsonb,
  effective_from date,
  effective_to date,
  source_name text,
  extraction_scope text
)
language sql
stable
set search_path to 'public','extensions'
as $function$
  select
    g.source_version,
    g.code,
    g.base_code,
    g.modifier,
    g.code_system,
    g.description,
    g.minutes,
    g.example_services,
    g.notes,
    g.service_providers,
    g.place_of_service,
    g.provider_types,
    g.effective_from,
    g.effective_to,
    g.source_name,
    g.extraction_scope
  from public.sbhs_code_guidance g
  where upper(g.code)=upper(trim(p_code))
    and g.effective_from <= coalesce(p_service_date,current_date)
    and (g.effective_to is null or g.effective_to >= coalesce(p_service_date,current_date))
  order by g.effective_from desc, g.source_version desc
  limit 1;
$function$;
