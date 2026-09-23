alter table public.payments
  add column if not exists idempotency_key text;

create unique index if not exists payments_tenant_idempotency_uidx
  on public.payments (tenant_id, idempotency_key)
  where idempotency_key is not null;

alter table public.adjustments
  add column if not exists denial_id uuid references public.denials(id) on delete set null;

create unique index if not exists adjustments_tenant_denial_uidx
  on public.adjustments (tenant_id, denial_id)
  where denial_id is not null;

drop function if exists public.post_manual_payment(
  uuid,bigint,public.payment_source_enum,public.payment_method_enum,
  uuid,uuid,uuid,bigint,text,text,text
);

create or replace function public.post_manual_payment(
  p_tenant_id uuid,
  p_amount_cents bigint,
  p_source public.payment_source_enum,
  p_method public.payment_method_enum,
  p_client_id uuid default null::uuid,
  p_payer_id uuid default null::uuid,
  p_claim_id uuid default null::uuid,
  p_allocation_cents bigint default 0,
  p_trace_number text default null::text,
  p_check_number text default null::text,
  p_notes text default null::text,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_claim public.professional_claims%rowtype;
  v_payment public.payments%rowtype;
  v_existing public.payments%rowtype;
  v_client_id uuid := p_client_id;
  v_payer_id uuid := p_payer_id;
  v_paid bigint := 0;
  v_reducing bigint := 0;
  v_recovery bigint := 0;
  v_open bigint := 0;
  v_client_ar bigint := 0;
  v_source_paid bigint := 0;
  v_source_open bigint := 0;
  v_allocation bigint := greatest(0, coalesce(p_allocation_cents, 0));
  v_unapplied bigint := 0;
  v_status public.payment_status_enum;
  v_claim_status public.claim_status_enum;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')), '');
  v_entries jsonb;
  v_entry_type public.ledger_entry_type_enum;
  v_liability_account text;
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'User does not have write access to this tenant.';
  end if;

  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if v_key is not null then
    select * into v_existing
    from public.payments
    where tenant_id = p_tenant_id
      and idempotency_key = v_key
    limit 1;

    if found then
      if v_existing.amount_cents <> p_amount_cents
         or v_existing.payment_source <> p_source
         or v_existing.payment_method <> p_method then
        raise exception 'Idempotency key was already used for a different payment request.';
      end if;
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  if p_claim_id is not null then
    select pc.*
      into v_claim
    from public.professional_claims pc
    where pc.id = p_claim_id
      and pc.tenant_id = p_tenant_id
    for update;

    if not found then
      raise exception 'Selected claim was not found in this tenant.';
    end if;

    v_client_id := v_claim.client_id;
    if p_source = 'insurance'::public.payment_source_enum then
      v_payer_id := v_claim.payer_id;
    elsif p_source = 'patient'::public.payment_source_enum then
      v_payer_id := null;
    end if;

    select coalesce(sum(pa.amount_cents), 0)
      into v_paid
    from public.payment_allocations pa
    join public.payments p
      on p.id = pa.payment_id
     and p.tenant_id = pa.tenant_id
    where pa.claim_id = p_claim_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at is null
      and p.payment_status not in (
        'reversed'::public.payment_status_enum,
        'voided'::public.payment_status_enum,
        'refunded'::public.payment_status_enum
      );

    select
      coalesce(sum(case
        when a.adjustment_type not in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then aa.amount_cents else 0 end), 0),
      coalesce(sum(case
        when a.adjustment_type in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then aa.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustment_allocations aa
    join public.adjustments a
      on a.id = aa.adjustment_id
     and a.tenant_id = aa.tenant_id
    where aa.claim_id = p_claim_id
      and aa.tenant_id = p_tenant_id
      and a.adjustment_status = 'posted'::public.adjustment_status_enum;

    v_open := greatest(0, coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery);

    if p_source in ('patient'::public.payment_source_enum, 'insurance'::public.payment_source_enum) then
      select coalesce(sum(pa.amount_cents), 0)
        into v_source_paid
      from public.payment_allocations pa
      join public.payments p
        on p.id = pa.payment_id
       and p.tenant_id = pa.tenant_id
      where pa.claim_id = p_claim_id
        and pa.tenant_id = p_tenant_id
        and pa.reversed_at is null
        and p.payment_source = p_source
        and p.payment_status not in (
          'reversed'::public.payment_status_enum,
          'voided'::public.payment_status_enum,
          'refunded'::public.payment_status_enum
        );

      if p_source = 'patient'::public.payment_source_enum then
        v_source_open := case
          when coalesce(v_claim.metadata, '{}'::jsonb) ? 'patient_responsibility_cents'
            then greatest(0, coalesce((v_claim.metadata ->> 'patient_responsibility_cents')::bigint, 0) - v_source_paid)
          when v_claim.claim_status = 'patient_responsibility'::public.claim_status_enum
            then v_open
          else 0
        end;
      else
        v_source_open := case
          when coalesce(v_claim.metadata, '{}'::jsonb) ? 'insurance_responsibility_cents'
            then greatest(0, coalesce((v_claim.metadata ->> 'insurance_responsibility_cents')::bigint, 0) - v_source_paid)
          else v_open
        end;
      end if;
    else
      v_source_open := v_open;
    end if;

    v_allocation := least(v_allocation, v_open, v_source_open, p_amount_cents);
  else
    if p_source = 'patient'::public.payment_source_enum
       and v_client_id is not null
       and v_allocation > 0 then
      select coalesce(sum(
        case when le.side = 'debit'::public.ledger_side_enum then le.amount_cents else -le.amount_cents end
      ),0)
      into v_client_ar
      from public.ledger_entries le
      join public.ledger_accounts la
        on la.id = le.ledger_account_id
       and la.tenant_id = le.tenant_id
      where le.tenant_id = p_tenant_id
        and le.client_id = v_client_id
        and la.account_code = '1100';

      v_allocation := least(v_allocation, p_amount_cents, greatest(0, v_client_ar));
    else
      v_allocation := 0;
    end if;
  end if;

  if p_source = 'patient'::public.payment_source_enum and v_client_id is null then
    raise exception 'Patient payments require a patient or a patient-owned claim.';
  end if;
  if p_source = 'insurance'::public.payment_source_enum and v_payer_id is null then
    raise exception 'Insurance payments require a payer or a payer-owned claim.';
  end if;

  if v_client_id is not null and not exists (
    select 1 from public.clients c where c.id = v_client_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Selected patient is outside this tenant.';
  end if;

  if v_payer_id is not null and not exists (
    select 1 from public.payers p where p.id = v_payer_id
  ) then
    raise exception 'Selected payer was not found.';
  end if;

  v_unapplied := greatest(0, p_amount_cents - v_allocation);
  v_status := case
    when v_allocation = 0 then 'unapplied'::public.payment_status_enum
    when v_unapplied = 0 then 'posted'::public.payment_status_enum
    else 'partially_applied'::public.payment_status_enum
  end;

  begin
    insert into public.payments (
      tenant_id, client_id, payer_id, payment_source, payment_method,
      payment_status, payment_date, amount_cents, trace_number, check_number,
      notes, posted_by, posted_at, idempotency_key
    ) values (
      p_tenant_id, v_client_id, v_payer_id, p_source, p_method,
      v_status, current_date, p_amount_cents, nullif(trim(p_trace_number), ''),
      nullif(trim(p_check_number), ''), nullif(trim(p_notes), ''),
      auth.uid(), case when v_allocation > 0 then now() else null end, v_key
    )
    returning * into v_payment;
  exception when unique_violation then
    if v_key is not null then
      select * into v_existing
      from public.payments
      where tenant_id = p_tenant_id
        and idempotency_key = v_key
      limit 1;
      if found then
        return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
      end if;
    end if;
    raise;
  end;

  if v_allocation > 0 then
    insert into public.payment_allocations (
      tenant_id, payment_id, client_id, claim_id, amount_cents
    ) values (
      p_tenant_id, v_payment.id, v_client_id, p_claim_id, v_allocation
    );
  end if;

  v_entry_type := case
    when p_source = 'patient'::public.payment_source_enum
      then 'patient_payment'::public.ledger_entry_type_enum
    else 'insurance_payment'::public.ledger_entry_type_enum
  end;
  v_liability_account := case
    when p_source = 'patient'::public.payment_source_enum then '2100'
    else '2110'
  end;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'account_code','1010','side','debit','entry_type',v_entry_type::text,
      'amount_cents',p_amount_cents,'client_id',v_client_id,'payer_id',v_payer_id,
      'description','Payment receipt'
    )
  );

  if v_allocation > 0 then
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'account_code','1100','side','credit','entry_type',v_entry_type::text,
        'amount_cents',v_allocation,'client_id',v_client_id,'claim_id',p_claim_id,
        'payer_id',v_payer_id,'description','Payment applied to accounts receivable'
      )
    );
  end if;

  if v_unapplied > 0 then
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'account_code',v_liability_account,'side','credit','entry_type',v_entry_type::text,
        'amount_cents',v_unapplied,
        'client_id',case when p_source='patient'::public.payment_source_enum then v_client_id else null end,
        'payer_id',case when p_source='insurance'::public.payment_source_enum then v_payer_id else null end,
        'description','Unapplied payment balance'
      )
    );
  end if;

  perform public.create_ledger_transaction(
    p_tenant_id,
    'payment_receipt',
    v_payment.id,
    'Manual payment receipt',
    v_entries,
    current_date
  );

  if p_claim_id is not null and v_allocation > 0 then
    v_open := greatest(0, v_open - v_allocation);
    v_claim_status := case
      when v_open = 0 then 'paid'::public.claim_status_enum
      when v_claim.claim_status = 'patient_responsibility'::public.claim_status_enum
        then 'patient_responsibility'::public.claim_status_enum
      else 'partially_paid'::public.claim_status_enum
    end;

    if v_claim.claim_status in (
      'accepted'::public.claim_status_enum,
      'partially_paid'::public.claim_status_enum,
      'patient_responsibility'::public.claim_status_enum,
      'paid'::public.claim_status_enum
    ) then
      update public.professional_claims pc
      set claim_status = v_claim_status,
          paid_at = case when v_claim_status = 'paid'::public.claim_status_enum then now() else null end,
          updated_at = now()
      where pc.id = p_claim_id
        and pc.tenant_id = p_tenant_id;
    end if;

    perform public.recalculate_claim_balance_summary(p_claim_id);
  end if;

  if v_client_id is not null then
    perform public.recalculate_client_balance_summary(v_client_id);
  end if;

  return to_jsonb(v_payment) || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.post_manual_payment(
  uuid,bigint,public.payment_source_enum,public.payment_method_enum,
  uuid,uuid,uuid,bigint,text,text,text,text
) from public;
grant execute on function public.post_manual_payment(
  uuid,bigint,public.payment_source_enum,public.payment_method_enum,
  uuid,uuid,uuid,bigint,text,text,text,text
) to authenticated, service_role;

create or replace function public.recalculate_claim_balance_summary(p_claim_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant_id uuid;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_reducing bigint := 0;
  v_recovery bigint := 0;
  v_net_adjustment bigint := 0;
  v_open bigint := 0;
begin
  select tenant_id, total_charge_cents
    into v_tenant_id, v_total
  from public.professional_claims
  where id = p_claim_id;

  if v_tenant_id is null then
    return;
  end if;

  select coalesce(sum(pa.amount_cents),0)
    into v_paid
  from public.payment_allocations pa
  join public.payments p
    on p.id = pa.payment_id
   and p.tenant_id = pa.tenant_id
  where pa.claim_id = p_claim_id
    and pa.tenant_id = v_tenant_id
    and pa.reversed_at is null
    and p.payment_status not in (
      'reversed'::public.payment_status_enum,
      'voided'::public.payment_status_enum,
      'refunded'::public.payment_status_enum
    );

  select
    coalesce(sum(case
      when a.adjustment_type not in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
        then aa.amount_cents else 0 end),0),
    coalesce(sum(case
      when a.adjustment_type in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
        then aa.amount_cents else 0 end),0)
    into v_reducing, v_recovery
  from public.adjustment_allocations aa
  join public.adjustments a
    on a.id = aa.adjustment_id
   and a.tenant_id = aa.tenant_id
  where aa.claim_id = p_claim_id
    and aa.tenant_id = v_tenant_id
    and a.adjustment_status = 'posted'::public.adjustment_status_enum;

  v_net_adjustment := v_reducing - v_recovery;
  v_open := greatest(0, coalesce(v_total,0) - v_paid - v_reducing + v_recovery);

  insert into public.claim_balance_summaries (
    claim_id, tenant_id, total_charge_cents, paid_amount_cents,
    adjustment_amount_cents, open_balance_cents, last_calculated_at
  ) values (
    p_claim_id, v_tenant_id, coalesce(v_total,0), v_paid,
    v_net_adjustment, v_open, now()
  )
  on conflict (claim_id) do update
  set total_charge_cents = excluded.total_charge_cents,
      paid_amount_cents = excluded.paid_amount_cents,
      adjustment_amount_cents = excluded.adjustment_amount_cents,
      open_balance_cents = excluded.open_balance_cents,
      last_calculated_at = now();
end;
$function$;

create or replace function public.rcm_create_claim_batch(
  p_tenant_id uuid,
  p_claim_ids uuid[],
  p_batch_name text default null::text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
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
      and cb.batch_status in (
        'created'::public.claim_batch_status_enum,
        'ready'::public.claim_batch_status_enum
      )
  ) then
    raise exception 'One or more selected claims already belong to an untransmitted batch.';
  end if;

  insert into public.claim_batches (
    tenant_id, batch_status, batch_name, claim_count,
    total_charge_cents, created_by
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
    tenant_id, batch_id, claim_id
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
    tenant_id, claim_id, old_status, new_status, changed_by, reason
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
    return jsonb_build_object(
      'denial_id', p_denial_id,
      'adjustment_id', v_existing.id,
      'writeoff_cents', v_existing.amount_cents,
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

revoke all on function public.post_denial_writeoff(uuid,uuid) from public;
grant execute on function public.post_denial_writeoff(uuid,uuid) to authenticated, service_role;

do $recalc$
declare
  v_claim record;
begin
  for v_claim in
    select id from public.professional_claims
  loop
    perform public.recalculate_claim_balance_summary(v_claim.id);
  end loop;
end;
$recalc$;

