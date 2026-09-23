create or replace function public.post_denial_writeoff(
  p_tenant_id uuid,
  p_denial_id uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_denial public.denials%rowtype;
  v_claim public.professional_claims%rowtype;
  v_existing public.adjustments%rowtype;
  v_adjustment public.adjustments%rowtype;
  v_policy jsonb;
  v_open bigint := 0;
  v_writeoff bigint := 0;
  v_after_open bigint := 0;
  v_type public.adjustment_type_enum;
  v_entries jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  select * into v_denial
  from public.denials
  where tenant_id = p_tenant_id
    and id = p_denial_id
  for update;

  if not found then
    raise exception 'Denial not found.';
  end if;

  select * into v_existing
  from public.adjustments
  where tenant_id = p_tenant_id
    and denial_id = p_denial_id
  limit 1;

  if found then
    if v_denial.claim_id is not null then
      perform public.recalculate_claim_balance_summary(v_denial.claim_id);
      select open_balance_cents
        into v_after_open
      from public.claim_balance_summaries
      where claim_id = v_denial.claim_id
        and tenant_id = p_tenant_id;
    end if;

    return jsonb_build_object(
      'denial_id', p_denial_id,
      'adjustment_id', v_existing.id,
      'writeoff_cents', v_existing.amount_cents,
      'open_balance_cents', coalesce(v_after_open,0),
      'idempotent_replay', true
    );
  end if;

  v_policy := public.classify_denial_from_carc(v_denial.carc_code);
  if v_denial.denial_category not in (
      'credentialing'::public.denial_category_enum,
      'contracting'::public.denial_category_enum
    )
    and coalesce(v_policy ->> 'workability','') <> 'auto_writeoff' then
    raise exception 'This denial is not configured for automatic write-off.';
  end if;

  if v_denial.claim_id is null then
    raise exception 'A linked claim is required for denial write-off.';
  end if;

  select * into v_claim
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = v_denial.claim_id
  for update;

  if not found then
    raise exception 'Linked claim not found.';
  end if;

  perform public.recalculate_claim_balance_summary(v_claim.id);

  select open_balance_cents
    into v_open
  from public.claim_balance_summaries
  where claim_id = v_claim.id
    and tenant_id = p_tenant_id;

  v_writeoff := least(greatest(0, coalesce(v_denial.amount_cents,0)), greatest(0, coalesce(v_open,0)));

  if v_writeoff > 0 then
    v_type := case
      when v_denial.denial_category = 'credentialing'::public.denial_category_enum
        or coalesce(v_policy ->> 'denial_category','') = 'credentialing'
        then 'credentialing_writeoff'::public.adjustment_type_enum
      else 'payer_writeoff'::public.adjustment_type_enum
    end;

    insert into public.adjustments (
      tenant_id, client_id, claim_id, payer_id, denial_id,
      adjustment_type, adjustment_status, adjustment_date,
      amount_cents, reason, carc_code, posted_by, posted_at
    ) values (
      p_tenant_id, v_denial.client_id, v_claim.id, v_denial.payer_id, v_denial.id,
      v_type, 'posted'::public.adjustment_status_enum, current_date,
      v_writeoff,
      'Configured non-workable denial write-off policy.',
      v_denial.carc_code,
      auth.uid(),
      now()
    )
    returning * into v_adjustment;

    insert into public.adjustment_allocations (
      tenant_id, adjustment_id, client_id, claim_id, amount_cents
    ) values (
      p_tenant_id, v_adjustment.id, v_denial.client_id, v_claim.id, v_writeoff
    );

    v_entries := jsonb_build_array(
      jsonb_build_object(
        'account_code','4030','side','debit','entry_type','adjustment',
        'amount_cents',v_writeoff,'client_id',v_denial.client_id,
        'claim_id',v_claim.id,'payer_id',v_denial.payer_id,
        'description','Configured credentialing/contracting denial write-off'
      ),
      jsonb_build_object(
        'account_code','1100','side','credit','entry_type','adjustment',
        'amount_cents',v_writeoff,'client_id',v_denial.client_id,
        'claim_id',v_claim.id,'payer_id',v_denial.payer_id,
        'description','Reduce accounts receivable for denial write-off'
      )
    );

    perform public.create_ledger_transaction(
      p_tenant_id,
      'denial_writeoff',
      v_adjustment.id,
      'Configured denial write-off',
      v_entries,
      current_date
    );
  end if;

  update public.denials
  set denial_status = 'resolved_writeoff'::public.denial_status_enum,
      workability = 'auto_writeoff'::public.denial_workability_enum,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_denial_id;

  update public.workqueue_items
  set workqueue_status = 'completed'::public.workqueue_status_enum,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where tenant_id = p_tenant_id
    and source_object_type = 'denial'::public.workqueue_source_object_type_enum
    and source_object_id = p_denial_id
    and workqueue_type = 'denial_followup'::public.workqueue_type_enum
    and workqueue_status in (
      'open'::public.workqueue_status_enum,
      'in_progress'::public.workqueue_status_enum,
      'pending'::public.workqueue_status_enum,
      'snoozed'::public.workqueue_status_enum,
      'reopened'::public.workqueue_status_enum
    );

  perform public.recalculate_claim_balance_summary(v_claim.id);
  perform public.recalculate_client_balance_summary(v_claim.client_id);

  select open_balance_cents
    into v_after_open
  from public.claim_balance_summaries
  where claim_id = v_claim.id
    and tenant_id = p_tenant_id;

  if v_claim.claim_status not in (
    'voided'::public.claim_status_enum,
    'reversed'::public.claim_status_enum
  ) then
    update public.professional_claims
    set claim_status = case
        when coalesce(v_after_open,0) = 0 then 'paid'::public.claim_status_enum
        else 'partially_paid'::public.claim_status_enum
      end,
      paid_at = case when coalesce(v_after_open,0) = 0 then coalesce(paid_at, now()) else null end,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_claim.id;
  end if;

  return jsonb_build_object(
    'denial_id', p_denial_id,
    'adjustment_id', v_adjustment.id,
    'writeoff_cents', v_writeoff,
    'open_balance_cents', coalesce(v_after_open,0),
    'idempotent_replay', false
  );
end;
$function$;
