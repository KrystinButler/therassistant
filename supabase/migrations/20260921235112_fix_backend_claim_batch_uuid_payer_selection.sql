
create or replace function public.rcm_create_claim_batch(
  p_tenant_id uuid,
  p_claim_ids uuid[],
  p_batch_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_claim_count integer;
  v_total_charge_cents bigint;
  v_batch_id uuid;
  v_payer_count integer;
  v_payer_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    raise exception 'Select at least one claim for the batch.';
  end if;

  perform 1
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids)
  for update;

  select
    count(distinct id),
    count(distinct payer_id),
    coalesce(sum(total_charge_cents), 0)
  into
    v_claim_count,
    v_payer_count,
    v_total_charge_cents
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  select pc.payer_id
    into v_payer_id
  from public.professional_claims pc
  where pc.tenant_id = p_tenant_id
    and pc.id = any(p_claim_ids)
    and pc.payer_id is not null
  limit 1;

  if v_claim_count <> cardinality(p_claim_ids) then
    raise exception 'One or more selected claims were not found in this tenant.';
  end if;

  if exists (
    select 1
    from public.professional_claims
    where tenant_id = p_tenant_id
      and id = any(p_claim_ids)
      and claim_status <> 'ready_for_batch'::public.claim_status_enum
  ) then
    raise exception 'All claims must pass validation before batching.';
  end if;

  if v_payer_count <> 1 or v_payer_id is null then
    raise exception 'A claim batch must contain claims for exactly one payer.';
  end if;

  if exists (
    select 1
    from public.claim_batch_items cbi
    join public.claim_batches cb
      on cb.id = cbi.batch_id
     and cb.tenant_id = cbi.tenant_id
    where cbi.tenant_id = p_tenant_id
      and cbi.claim_id = any(p_claim_ids)
      and cb.batch_status <> 'voided'::public.claim_batch_status_enum
  ) then
    raise exception 'One or more selected claims already belong to an active batch.';
  end if;

  insert into public.claim_batches (
    tenant_id,
    batch_status,
    batch_name,
    claim_count,
    total_charge_cents,
    created_by
  ) values (
    p_tenant_id,
    'ready'::public.claim_batch_status_enum,
    coalesce(nullif(trim(p_batch_name), ''), '837P ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_claim_count,
    v_total_charge_cents,
    auth.uid()
  )
  returning id into v_batch_id;

  insert into public.claim_batch_items (
    tenant_id,
    batch_id,
    claim_id
  )
  select p_tenant_id, v_batch_id, id
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  update public.professional_claims
  set claim_status = 'batched'::public.claim_status_enum,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  insert into public.claim_status_history (
    tenant_id,
    claim_id,
    old_status,
    new_status,
    changed_by,
    reason
  )
  select
    p_tenant_id,
    id,
    'ready_for_batch'::public.claim_status_enum,
    'batched'::public.claim_status_enum,
    auth.uid(),
    'Added to payer claim batch'
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = any(p_claim_ids);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'claim_count', v_claim_count,
    'payer_id', v_payer_id,
    'total_charge_cents', v_total_charge_cents
  );
end;
$function$;

revoke execute on function public.rcm_create_claim_batch(uuid, uuid[], text) from anon;
grant execute on function public.rcm_create_claim_batch(uuid, uuid[], text) to authenticated;
