begin;

alter table public.professional_claim_lines
  add column if not exists place_of_service text;

alter table public.professional_claim_lines
  drop constraint if exists professional_claim_lines_place_of_service_check;

alter table public.professional_claim_lines
  add constraint professional_claim_lines_place_of_service_check
  check (place_of_service is null or place_of_service ~ '^[0-9]{2}$');

create or replace function public.update_claims_edi_settings(
  p_tenant_id uuid,
  p_config jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_settings jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'Claims EDI configuration must be a JSON object';
  end if;

  update public.tenants
  set settings = jsonb_set(
        coalesce(settings, '{}'::jsonb),
        '{claims_837p}',
        p_config,
        true
      ),
      updated_at = now()
  where id = p_tenant_id
  returning settings -> 'claims_837p' into v_settings;

  if v_settings is null then
    raise exception 'Tenant not found or not writable';
  end if;

  return v_settings;
end;
$function$;

revoke all on function public.update_claims_edi_settings(uuid, jsonb) from public;
revoke all on function public.update_claims_edi_settings(uuid, jsonb) from anon;
grant execute on function public.update_claims_edi_settings(uuid, jsonb) to authenticated;
grant execute on function public.update_claims_edi_settings(uuid, jsonb) to service_role;

commit;
