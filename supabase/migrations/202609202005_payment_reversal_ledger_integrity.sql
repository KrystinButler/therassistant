begin;

create or replace function public.reverse_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_payment public.payments%rowtype;
  v_reversal_id uuid;
  v_reversed_at timestamptz := now();
  v_claim_id uuid;
  v_claim public.professional_claims%rowtype;
  v_paid bigint;
  v_reducing bigint;
  v_recovery bigint;
  v_open bigint;
  v_financial_status public.claim_status_enum;
  v_allocation_count integer := 0;
  v_patient_responsibility bigint := 0;
  v_patient_paid bigint := 0;
  v_reversal_entries jsonb;
  v_ledger_transaction_id uuid;
  v_client_id uuid;
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'User does not have write access to this tenant.';
  end if;
  if p_payment_id is null then
    raise exception 'Payment is required.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Reversal reason is required.';
  end if;

  select p.*
    into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Payment not found in this tenant.';
  end if;

  if v_payment.payment_status in (
    'reversed'::public.payment_status_enum,
    'voided'::public.payment_status_enum
  ) then
    raise exception 'Payment is already reversed or voided.';
  end if;

  perform 1
  from public.payment_allocations pa
  where pa.payment_id = p_payment_id
    and pa.tenant_id = p_tenant_id
    and pa.reversed_at is null
  for update;

  insert into public.payment_reversals (
    tenant_id, payment_id, reason, reversed_by
  ) values (
    p_tenant_id, p_payment_id, trim(p_reason), auth.uid()
  )
  returning id into v_reversal_id;

  select jsonb_agg(
    jsonb_build_object(
      'account_code', la.account_code,
      'side', case
        when le.side = 'debit'::public.ledger_side_enum then 'credit'
        else 'debit'
      end,
      'entry_type', le.entry_type::text,
      'amount_cents', le.amount_cents,
      'client_id', le.client_id,
      'claim_id', le.claim_id,
      'payer_id', le.payer_id,
      'description', concat(
        'Reverse payment ',
        coalesce(nullif(trim(p_reason), ''), 'payment reversal'),
        case
          when nullif(trim(coalesce(le.description, '')), '') is not null
            then concat(' · Original: ', le.description)
          else ''
        end
      )
    )
    order by lt.created_at, le.created_at, le.id
  )
  into v_reversal_entries
  from public.ledger_transactions lt
  join public.ledger_entries le
    on le.ledger_transaction_id = lt.id
   and le.tenant_id = lt.tenant_id
  join public.ledger_accounts la
    on la.id = le.ledger_account_id
   and la.tenant_id = le.tenant_id
  where lt.tenant_id = p_tenant_id
    and lt.source_id = p_payment_id
    and lt.source_type in ('payment_receipt', 'payment_allocation');

  if v_reversal_entries is not null and jsonb_array_length(v_reversal_entries) > 0 then
    v_ledger_transaction_id := public.create_ledger_transaction(
      p_tenant_id,
      'payment_reversal',
      v_reversal_id,
      concat('Reverse payment: ', trim(p_reason)),
      v_reversal_entries,
      current_date
    );
  end if;

  update public.payment_allocations pa
  set reversed_at = v_reversed_at,
      updated_at = v_reversed_at
  where pa.payment_id = p_payment_id
    and pa.tenant_id = p_tenant_id
    and pa.reversed_at is null;

  get diagnostics v_allocation_count = row_count;

  update public.payments p
  set payment_status = 'reversed'::public.payment_status_enum,
      updated_at = v_reversed_at
  where p.id = p_payment_id
    and p.tenant_id = p_tenant_id;

  for v_claim_id in
    select distinct pa.claim_id
    from public.payment_allocations pa
    where pa.payment_id = p_payment_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at = v_reversed_at
      and pa.claim_id is not null
  loop
    select pc.*
      into v_claim
    from public.professional_claims pc
    where pc.id = v_claim_id
      and pc.tenant_id = p_tenant_id
    for update;

    if not found then
      continue;
    end if;

    select coalesce(sum(pa.amount_cents), 0)
      into v_paid
    from public.payment_allocations pa
    join public.payments p
      on p.id = pa.payment_id
     and p.tenant_id = pa.tenant_id
    where pa.claim_id = v_claim_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at is null
      and p.payment_status not in (
        'reversed'::public.payment_status_enum,
        'voided'::public.payment_status_enum
      );

    select
      coalesce(sum(case
        when a.adjustment_type not in (
          'recoupment'::public.adjustment_type_enum,
          'refund_correction'::public.adjustment_type_enum
        ) then a.amount_cents else 0 end), 0),
      coalesce(sum(case
        when a.adjustment_type in (
          'recoupment'::public.adjustment_type_enum,
          'refund_correction'::public.adjustment_type_enum
        ) then a.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = v_claim_id
      and a.tenant_id = p_tenant_id
      and a.adjustment_status not in (
        'reversed'::public.adjustment_status_enum,
        'voided'::public.adjustment_status_enum
      );

    v_open := greatest(
      0,
      coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery
    );

    select coalesce(sum(pa.amount_cents), 0)
      into v_patient_paid
    from public.payment_allocations pa
    join public.payments p
      on p.id = pa.payment_id
     and p.tenant_id = pa.tenant_id
    where pa.claim_id = v_claim_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at is null
      and p.payment_source = 'patient'::public.payment_source_enum
      and p.payment_status not in (
        'reversed'::public.payment_status_enum,
        'voided'::public.payment_status_enum
      );

    v_patient_responsibility := greatest(
      0,
      coalesce((v_claim.metadata ->> 'patient_responsibility_cents')::bigint, 0) - v_patient_paid
    );

    v_financial_status := case
      when v_open = 0 then 'paid'::public.claim_status_enum
      when v_patient_responsibility > 0
        and coalesce((v_claim.metadata ->> 'insurance_responsibility_cents')::bigint, 0) = 0
        then 'patient_responsibility'::public.claim_status_enum
      when v_paid > 0 or v_reducing > 0 or v_recovery > 0
        then 'partially_paid'::public.claim_status_enum
      else 'accepted'::public.claim_status_enum
    end;

    if v_claim.claim_status in (
      'accepted'::public.claim_status_enum,
      'partially_paid'::public.claim_status_enum,
      'patient_responsibility'::public.claim_status_enum,
      'paid'::public.claim_status_enum
    ) then
      update public.professional_claims pc
      set claim_status = v_financial_status,
          paid_at = case
            when v_financial_status = 'paid'::public.claim_status_enum
              then coalesce(pc.paid_at, v_reversed_at)
            else null
          end,
          updated_at = v_reversed_at
      where pc.id = v_claim_id
        and pc.tenant_id = p_tenant_id;
    end if;

    perform public.recalculate_claim_balance_summary(v_claim_id);
    perform public.recalculate_client_balance_summary(v_claim.client_id);
  end loop;

  if v_payment.client_id is not null then
    perform public.recalculate_client_balance_summary(v_payment.client_id);
  end if;

  for v_client_id in
    select distinct pa.client_id
    from public.payment_allocations pa
    where pa.payment_id = p_payment_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at = v_reversed_at
      and pa.client_id is not null
  loop
    perform public.recalculate_client_balance_summary(v_client_id);
  end loop;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'payment_status', 'reversed',
    'reversed_at', v_reversed_at,
    'allocation_count', v_allocation_count,
    'reversal_id', v_reversal_id,
    'ledger_transaction_id', v_ledger_transaction_id
  );
end;
$function$;

commit;
