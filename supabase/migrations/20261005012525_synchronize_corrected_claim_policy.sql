-- Keep insurance identity consistent for both direct claim edits and the
-- retry-safe rejection-correction RPC. The trigger runs with the caller's RLS.
create or replace function private.synchronize_corrected_claim_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_policy_id uuid;
begin
  if new.client_id is not distinct from old.client_id
     and new.payer_id is not distinct from old.payer_id then
    return new;
  end if;

  if new.payer_id is not null then
    -- Match the existing output selector: active primary, primary, then other
    -- coverage. Stable ties prefer the newest policy, then its ID.
    select p.id into v_policy_id
    from public.client_insurance_policies p
    where p.tenant_id = new.tenant_id
      and p.client_id = new.client_id and p.payer_id = new.payer_id
    order by case
      when p.status = 'active' and p.insurance_order = 'primary' then 0
      when p.insurance_order = 'primary' then 1
      else 2 end, p.created_at desc, p.id
    limit 1;
    if v_policy_id is null then
      raise exception 'Select matching insurance coverage for the corrected patient and payer before saving.'
        using errcode = '22023';
    end if;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'insurance_policy_id';
  if v_policy_id is not null then
    new.metadata := new.metadata || jsonb_build_object('insurance_policy_id', v_policy_id);
  end if;
  return new;
end;
$function$;

-- Trigger-only helper: no Data API callable surface or privileged execution.
revoke all on function private.synchronize_corrected_claim_policy() from public, anon, authenticated;
drop trigger if exists synchronize_corrected_claim_policy on public.professional_claims;
create trigger synchronize_corrected_claim_policy
before update of client_id, payer_id on public.professional_claims
for each row execute function private.synchronize_corrected_claim_policy();
