
create or replace function public.rcm_validate_claim(p_claim_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_claim_status public.claim_status_enum;
  v_tenant_id uuid;
begin
  select tenant_id, claim_status
    into v_tenant_id, v_claim_status
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim not found.';
  end if;

  perform public.assert_tenant_access(v_tenant_id);

  if v_claim_status not in (
    'ready_for_validation'::public.claim_status_enum,
    'validation_failed'::public.claim_status_enum,
    'corrected'::public.claim_status_enum
  ) then
    raise exception 'Claim cannot be validated from % status.', v_claim_status;
  end if;

  return public.validate_claim(p_claim_id);
end;
$function$;

revoke execute on function public.rcm_validate_claim(uuid) from anon;
grant execute on function public.rcm_validate_claim(uuid) to authenticated;
