-- Forward migration for environments where 20261006221500 already ran before HCPCS synchronization
-- was added to that replay-safe migration. Keep the compatibility parent complete and prevent
-- HCPCS shadow-parent rows from appearing as duplicate CPT search results.

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
