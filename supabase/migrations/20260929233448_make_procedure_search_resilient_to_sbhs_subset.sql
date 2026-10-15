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
  with sbhs_hcpcs as (
    select distinct on (g.base_code)
      g.base_code as code,
      g.description as name,
      g.effective_from,
      g.effective_to,
      g.source_name
    from public.sbhs_code_guidance g
    where g.source_version='2026_08'
      and g.code_system='HCPCS'
    order by g.base_code,
             case when g.code=g.base_code then 0 else 1 end,
             g.code
  ),
  candidates as (
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

    union all

    select
      s.code,
      s.name,
      'HCPCS'::text as system,
      'CO_SBHS_2026_08'::text as version,
      s.effective_from,
      s.effective_to,
      s.source_name as description_source,
      case
        when s.code = upper(trim(coalesce(p_search,''))) then 0
        when s.code ilike upper(trim(coalesce(p_search,''))) || '%' then 1
        else 3
      end as rank
    from sbhs_hcpcs s
    where s.effective_from <= coalesce(p_service_date,current_date)
      and (s.effective_to is null or s.effective_to >= coalesce(p_service_date,current_date))
      and (
        s.code ilike upper(trim(coalesce(p_search,''))) || '%'
        or s.name ilike '%' || trim(coalesce(p_search,'')) || '%'
      )
      and not exists (
        select 1
        from public.hcpcs_codes h
        where h.code=s.code
          and h.effective_from <= coalesce(p_service_date,current_date)
          and (h.effective_to is null or h.effective_to >= coalesce(p_service_date,current_date))
      )
  )
  select code, name, system, version, effective_from, effective_to, description_source
  from candidates
  order by rank, code
  limit least(greatest(coalesce(p_limit,20),1),50);
$function$;
