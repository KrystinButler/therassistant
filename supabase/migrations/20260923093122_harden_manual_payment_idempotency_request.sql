alter table public.payments
  add column if not exists idempotency_request jsonb;

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
  v_requested_allocation bigint := greatest(0, coalesce(p_allocation_cents, 0));
  v_allocation bigint := 0;
  v_unapplied bigint := 0;
  v_status public.payment_status_enum;
  v_claim_status public.claim_status_enum;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')), '');
  v_request jsonb;
  v_existing_request jsonb;
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

    v_allocation := least(v_requested_allocation, v_open, v_source_open, p_amount_cents);
  else
    if p_source = 'patient'::public.payment_source_enum
       and v_client_id is not null
       and v_requested_allocation > 0 then
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

      v_allocation := least(v_requested_allocation, p_amount_cents, greatest(0, v_client_ar));
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

  v_request := jsonb_build_object(
    'amount_cents', p_amount_cents,
    'source', p_source::text,
    'method', p_method::text,
    'client_id', v_client_id,
    'payer_id', v_payer_id,
    'claim_id', p_claim_id,
    'requested_allocation_cents', v_requested_allocation,
    'trace_number', nullif(trim(coalesce(p_trace_number,'')), ''),
    'check_number', nullif(trim(coalesce(p_check_number,'')), ''),
    'notes', nullif(trim(coalesce(p_notes,'')), '')
  );

  if v_key is not null then
    select * into v_existing
    from public.payments
    where tenant_id = p_tenant_id
      and idempotency_key = v_key
    limit 1;

    if found then
      v_existing_request := v_existing.idempotency_request;
      if v_existing_request is null then
        select jsonb_build_object(
          'amount_cents', v_existing.amount_cents,
          'source', v_existing.payment_source::text,
          'method', v_existing.payment_method::text,
          'client_id', v_existing.client_id,
          'payer_id', v_existing.payer_id,
          'claim_id', (
            select pa.claim_id
            from public.payment_allocations pa
            where pa.tenant_id = p_tenant_id
              and pa.payment_id = v_existing.id
              and pa.reversed_at is null
            order by pa.created_at
            limit 1
          ),
          'requested_allocation_cents', coalesce((
            select sum(pa.amount_cents)
            from public.payment_allocations pa
            where pa.tenant_id = p_tenant_id
              and pa.payment_id = v_existing.id
              and pa.reversed_at is null
          ),0),
          'trace_number', nullif(trim(coalesce(v_existing.trace_number,'')), ''),
          'check_number', nullif(trim(coalesce(v_existing.check_number,'')), ''),
          'notes', nullif(trim(coalesce(v_existing.notes,'')), '')
        ) into v_existing_request;
      end if;

      if v_existing_request is distinct from v_request then
        raise exception 'Idempotency key was already used for a different payment request.';
      end if;
      return to_jsonb(v_existing) || jsonb_build_object('idempotent_replay', true);
    end if;
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
      notes, posted_by, posted_at, idempotency_key, idempotency_request
    ) values (
      p_tenant_id, v_client_id, v_payer_id, p_source, p_method,
      v_status, current_date, p_amount_cents, nullif(trim(p_trace_number), ''),
      nullif(trim(p_check_number), ''), nullif(trim(p_notes), ''),
      auth.uid(), case when v_allocation > 0 then now() else null end, v_key, v_request
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
        if v_existing.idempotency_request is distinct from v_request then
          raise exception 'Idempotency key was already used for a different payment request.';
        end if;
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

