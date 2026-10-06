-- Tag canonical parent rows that already existed before HCPCS synchronization.
-- HCPCS Level II codes are alphanumeric and may already have been backfilled from fee-rate data;
-- those conflicts must be marked as HCPCS so search_procedure_codes does not return duplicate CPT/HCPCS rows.

update public.cpt_codes c
set metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
      'code_system', 'HCPCS',
      'backfilled_from', coalesce(c.metadata ->> 'backfilled_from', 'hcpcs_codes')
    ),
    label_source = case
      when c.label_source is null or c.label_source in ('reference_fee_rates', 'hcpcs_reference_sync')
        then 'hcpcs_reference_sync'
      else c.label_source
    end,
    official_description_source = coalesce(c.official_description_source, 'CMS HCPCS'),
    updated_at = now()
where exists (
  select 1
  from public.hcpcs_codes h
  where upper(trim(h.code)) = upper(trim(c.code))
);
