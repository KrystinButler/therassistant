CREATE OR REPLACE FUNCTION public.ensure_default_ledger_accounts(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.assert_tenant_access(p_tenant_id);

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '1010', 'Cash / Deposits', 'asset'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '1010');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '1100', 'Accounts Receivable', 'receivable'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '1100');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '2100', 'Patient Credits / Refund Liability', 'liability'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '2100');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '2110', 'Unapplied Insurance / Payer Funds', 'liability'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '2110');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '3000', 'Opening Balance Equity', 'equity'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '3000');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '4000', 'Service Revenue', 'revenue'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '4000');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '4020', 'Contractual Adjustments / Writeoffs', 'contra_revenue'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '4020');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '4030', 'Bad Debt / Administrative Writeoffs', 'expense'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '4030');

  insert into public.ledger_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  select p_tenant_id, '4050', 'Refunds / Recoupments', 'contra_revenue'::public.ledger_account_type_enum, true
  where not exists (select 1 from public.ledger_accounts where tenant_id = p_tenant_id and account_code = '4050');
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_manual_payment(p_tenant_id uuid, p_amount_cents bigint, p_source payment_source_enum, p_method payment_method_enum, p_client_id uuid DEFAULT NULL::uuid, p_payer_id uuid DEFAULT NULL::uuid, p_claim_id uuid DEFAULT NULL::uuid, p_allocation_cents bigint DEFAULT 0, p_trace_number text DEFAULT NULL::text, p_check_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.professional_claims%rowtype;
  v_payment public.payments%rowtype;
  v_client_id uuid := p_client_id;
  v_payer_id uuid := p_payer_id;
  v_paid bigint := 0;
  v_reducing bigint := 0;
  v_recovery bigint := 0;
  v_open bigint := 0;
  v_source_paid bigint := 0;
  v_source_open bigint := 0;
  v_allocation bigint := greatest(0, coalesce(p_allocation_cents, 0));
  v_unapplied bigint := 0;
  v_status public.payment_status_enum;
  v_claim_status public.claim_status_enum;
  v_entries jsonb := '[]'::jsonb;
  v_entry_type public.ledger_entry_type_enum;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if p_claim_id is not null then
    select pc.* into v_claim
    from public.professional_claims pc
    where pc.id = p_claim_id and pc.tenant_id = p_tenant_id
    for update;

    if not found then raise exception 'Selected claim was not found.'; end if;

    v_client_id := v_claim.client_id;
    if p_source = 'insurance'::public.payment_source_enum then
      v_payer_id := v_claim.payer_id;
    elsif p_source = 'patient'::public.payment_source_enum then
      v_payer_id := null;
    end if;

    select coalesce(sum(pa.amount_cents), 0) into v_paid
    from public.payment_allocations pa
    where pa.claim_id = p_claim_id and pa.tenant_id = p_tenant_id and pa.reversed_at is null;

    select
      coalesce(sum(case when a.adjustment_type not in ('recoupment','refund_correction') then a.amount_cents else 0 end), 0),
      coalesce(sum(case when a.adjustment_type in ('recoupment','refund_correction') then a.amount_cents else 0 end), 0)
    into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = p_claim_id
      and a.tenant_id = p_tenant_id
      and a.adjustment_status not in ('reversed','voided');

    v_open := greatest(0, coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery);

    if p_source in ('patient'::public.payment_source_enum, 'insurance'::public.payment_source_enum) then
      select coalesce(sum(pa.amount_cents), 0) into v_source_paid
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id and p.tenant_id = pa.tenant_id
      where pa.claim_id = p_claim_id
        and pa.tenant_id = p_tenant_id
        and pa.reversed_at is null
        and p.payment_source = p_source
        and p.payment_status not in ('reversed','voided');

      if p_source = 'patient'::public.payment_source_enum then
        v_source_open := case
          when coalesce(v_claim.metadata, '{}'::jsonb) ? 'patient_responsibility_cents'
            then greatest(0, coalesce((v_claim.metadata ->> 'patient_responsibility_cents')::bigint, 0) - v_source_paid)
          when v_claim.claim_status = 'patient_responsibility'::public.claim_status_enum then v_open
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
    v_allocation := 0;
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
    raise exception 'Selected patient is outside the active tenant.';
  end if;

  v_unapplied := p_amount_cents - v_allocation;
  v_status := case
    when v_allocation = 0 then 'unapplied'::public.payment_status_enum
    when v_unapplied = 0 then 'posted'::public.payment_status_enum
    else 'partially_applied'::public.payment_status_enum
  end;

  insert into public.payments (
    tenant_id, client_id, payer_id, payment_source, payment_method,
    payment_status, payment_date, amount_cents, trace_number, check_number,
    notes, posted_by, posted_at
  ) values (
    p_tenant_id, v_client_id, v_payer_id, p_source, p_method,
    v_status, current_date, p_amount_cents,
    nullif(trim(p_trace_number), ''), nullif(trim(p_check_number), ''),
    nullif(trim(p_notes), ''), auth.uid(),
    case when v_allocation > 0 then now() else null end
  ) returning * into v_payment;

  if p_claim_id is not null and v_allocation > 0 then
    insert into public.payment_allocations (
      tenant_id, payment_id, client_id, claim_id, amount_cents
    ) values (
      p_tenant_id, v_payment.id, v_client_id, p_claim_id, v_allocation
    );
  end if;

  v_entry_type := case
    when p_source = 'patient'::public.payment_source_enum then 'patient_payment'::public.ledger_entry_type_enum
    else 'insurance_payment'::public.ledger_entry_type_enum
  end;

  v_entries := v_entries || jsonb_build_array(jsonb_build_object(
    'account_code','1010','side','debit','entry_type',v_entry_type::text,
    'amount_cents',p_amount_cents,'client_id',v_client_id,'claim_id',p_claim_id,
    'payer_id',v_payer_id,'description','Payment receipt'
  ));

  if v_allocation > 0 then
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_code','1100','side','credit','entry_type',v_entry_type::text,
      'amount_cents',v_allocation,'client_id',v_client_id,'claim_id',p_claim_id,
      'payer_id',v_payer_id,'description','Payment applied to accounts receivable'
    ));
  end if;

  if v_unapplied > 0 then
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_code',case when p_source = 'patient'::public.payment_source_enum then '2100' else '2110' end,
      'side','credit','entry_type',v_entry_type::text,
      'amount_cents',v_unapplied,
      'client_id',case when p_source = 'patient'::public.payment_source_enum then v_client_id else null end,
      'payer_id',case when p_source = 'insurance'::public.payment_source_enum then v_payer_id else null end,
      'description','Unapplied payment balance'
    ));
  end if;

  perform public.create_ledger_transaction(
    p_tenant_id, 'payment_receipt', v_payment.id,
    'Payment receipt', v_entries, current_date
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
      update public.professional_claims
      set claim_status = v_claim_status,
          paid_at = case when v_claim_status = 'paid'::public.claim_status_enum then now() else null end,
          updated_at = now()
      where id = p_claim_id and tenant_id = p_tenant_id;
    end if;

    perform public.recalculate_claim_balance_summary(p_claim_id);
  end if;

  if v_client_id is not null then
    perform public.recalculate_client_balance_summary(v_client_id);
  end if;

  return to_jsonb(v_payment);
end;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_payment(p_tenant_id uuid, p_payment_id uuid, p_claim_id uuid, p_amount_cents bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment public.payments%rowtype;
  v_claim public.professional_claims%rowtype;
  v_payment_allocated bigint := 0;
  v_available bigint := 0;
  v_paid bigint := 0;
  v_reducing bigint := 0;
  v_recovery bigint := 0;
  v_open bigint := 0;
  v_source_paid bigint := 0;
  v_source_open bigint := 0;
  v_amount bigint := 0;
  v_unapplied bigint := 0;
  v_claim_status public.claim_status_enum;
  v_has_receipt_ledger boolean := false;
  v_entries jsonb := '[]'::jsonb;
  v_entry_type public.ledger_entry_type_enum;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if coalesce(p_amount_cents,0) <= 0 then raise exception 'Allocation amount must be greater than zero.'; end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id and tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_payment.payment_status in ('reversed','voided') then raise exception 'Reversed or voided payments cannot be allocated.'; end if;

  select * into v_claim
  from public.professional_claims
  where id = p_claim_id and tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'Claim not found.'; end if;

  if v_payment.payment_source = 'insurance'::public.payment_source_enum
     and v_payment.payer_id is not null and v_claim.payer_id is not null
     and v_payment.payer_id <> v_claim.payer_id then
    raise exception 'Insurance payment payer does not match the selected claim.';
  end if;
  if v_payment.payment_source = 'patient'::public.payment_source_enum
     and v_payment.client_id is not null and v_payment.client_id <> v_claim.client_id then
    raise exception 'Patient payment does not match the selected claim.';
  end if;

  select coalesce(sum(amount_cents),0) into v_payment_allocated
  from public.payment_allocations
  where payment_id = p_payment_id and tenant_id = p_tenant_id and reversed_at is null;
  v_available := greatest(0, v_payment.amount_cents - v_payment_allocated);

  select coalesce(sum(amount_cents),0) into v_paid
  from public.payment_allocations
  where claim_id = p_claim_id and tenant_id = p_tenant_id and reversed_at is null;

  select
    coalesce(sum(case when adjustment_type not in ('recoupment','refund_correction') then amount_cents else 0 end),0),
    coalesce(sum(case when adjustment_type in ('recoupment','refund_correction') then amount_cents else 0 end),0)
  into v_reducing, v_recovery
  from public.adjustments
  where claim_id = p_claim_id and tenant_id = p_tenant_id
    and adjustment_status not in ('reversed','voided');

  v_open := greatest(0, v_claim.total_charge_cents - v_paid - v_reducing + v_recovery);

  if v_payment.payment_source in ('patient'::public.payment_source_enum,'insurance'::public.payment_source_enum) then
    select coalesce(sum(pa.amount_cents),0) into v_source_paid
    from public.payment_allocations pa
    join public.payments p on p.id=pa.payment_id and p.tenant_id=pa.tenant_id
    where pa.claim_id=p_claim_id and pa.tenant_id=p_tenant_id
      and pa.reversed_at is null
      and p.payment_source=v_payment.payment_source
      and p.payment_status not in ('reversed','voided');

    if v_payment.payment_source='patient'::public.payment_source_enum then
      v_source_open := case
        when coalesce(v_claim.metadata,'{}'::jsonb) ? 'patient_responsibility_cents'
          then greatest(0,coalesce((v_claim.metadata->>'patient_responsibility_cents')::bigint,0)-v_source_paid)
        when v_claim.claim_status='patient_responsibility'::public.claim_status_enum then v_open
        else 0 end;
    else
      v_source_open := case
        when coalesce(v_claim.metadata,'{}'::jsonb) ? 'insurance_responsibility_cents'
          then greatest(0,coalesce((v_claim.metadata->>'insurance_responsibility_cents')::bigint,0)-v_source_paid)
        else v_open end;
    end if;
  else
    v_source_open := v_open;
  end if;

  v_amount := least(p_amount_cents, v_available, v_open, v_source_open);
  if v_amount <= 0 then raise exception 'No allocatable balance remains for this payment and claim.'; end if;

  insert into public.payment_allocations (tenant_id,payment_id,client_id,claim_id,amount_cents)
  values (p_tenant_id,p_payment_id,v_claim.client_id,p_claim_id,v_amount);

  v_unapplied := greatest(0, v_available - v_amount);

  update public.payments
  set client_id = case when v_payment.payment_source='patient'::public.payment_source_enum then coalesce(client_id,v_claim.client_id) else client_id end,
      payer_id = case when v_payment.payment_source='insurance'::public.payment_source_enum then coalesce(payer_id,v_claim.payer_id) else payer_id end,
      payment_status = case when v_unapplied=0 then 'posted'::public.payment_status_enum else 'partially_applied'::public.payment_status_enum end,
      posted_at = now(),
      updated_at = now()
  where id=p_payment_id and tenant_id=p_tenant_id;

  select exists(
    select 1 from public.ledger_transactions
    where tenant_id=p_tenant_id and source_type='payment_receipt' and source_id=p_payment_id
  ) into v_has_receipt_ledger;

  v_entry_type := case
    when v_payment.payment_source='patient'::public.payment_source_enum then 'patient_payment'::public.ledger_entry_type_enum
    else 'insurance_payment'::public.ledger_entry_type_enum
  end;

  if v_has_receipt_ledger then
    v_entries := jsonb_build_array(
      jsonb_build_object(
        'account_code',case when v_payment.payment_source='patient'::public.payment_source_enum then '2100' else '2110' end,
        'side','debit','entry_type',v_entry_type::text,'amount_cents',v_amount,
        'client_id',case when v_payment.payment_source='patient'::public.payment_source_enum then v_claim.client_id else null end,
        'payer_id',case when v_payment.payment_source='insurance'::public.payment_source_enum then v_claim.payer_id else null end,
        'description','Apply previously unapplied payment'
      ),
      jsonb_build_object(
        'account_code','1100','side','credit','entry_type',v_entry_type::text,'amount_cents',v_amount,
        'client_id',v_claim.client_id,'claim_id',p_claim_id,'payer_id',v_claim.payer_id,
        'description','Payment applied to accounts receivable'
      )
    );
    perform public.create_ledger_transaction(
      p_tenant_id,'payment_allocation',p_payment_id,'Allocate previously unapplied payment',v_entries,current_date
    );
  else
    v_entries := jsonb_build_array(
      jsonb_build_object(
        'account_code','1010','side','debit','entry_type',v_entry_type::text,
        'amount_cents',v_payment.amount_cents,'client_id',v_payment.client_id,'payer_id',v_payment.payer_id,
        'description','Legacy payment receipt'
      ),
      jsonb_build_object(
        'account_code','1100','side','credit','entry_type',v_entry_type::text,
        'amount_cents',v_payment_allocated + v_amount,'client_id',v_claim.client_id,'claim_id',p_claim_id,
        'payer_id',v_claim.payer_id,'description','Payment applied to accounts receivable'
      )
    );
    if v_unapplied > 0 then
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'account_code',case when v_payment.payment_source='patient'::public.payment_source_enum then '2100' else '2110' end,
        'side','credit','entry_type',v_entry_type::text,'amount_cents',v_unapplied,
        'client_id',case when v_payment.payment_source='patient'::public.payment_source_enum then v_claim.client_id else null end,
        'payer_id',case when v_payment.payment_source='insurance'::public.payment_source_enum then v_claim.payer_id else null end,
        'description','Unapplied payment balance'
      ));
    end if;
    perform public.create_ledger_transaction(
      p_tenant_id,'payment_receipt',p_payment_id,'Legacy payment receipt brought into ledger',v_entries,current_date
    );
  end if;

  v_open := greatest(0, v_open - v_amount);
  v_claim_status := case
    when v_open=0 then 'paid'::public.claim_status_enum
    when v_claim.claim_status='patient_responsibility'::public.claim_status_enum then 'patient_responsibility'::public.claim_status_enum
    else 'partially_paid'::public.claim_status_enum end;

  if v_claim.claim_status in ('accepted','partially_paid','patient_responsibility','paid') then
    update public.professional_claims
    set claim_status=v_claim_status,
        paid_at=case when v_claim_status='paid' then now() else null end,
        updated_at=now()
    where id=p_claim_id and tenant_id=p_tenant_id;
  end if;

  perform public.recalculate_claim_balance_summary(p_claim_id);
  perform public.recalculate_client_balance_summary(v_claim.client_id);

  return jsonb_build_object(
    'payment_id',p_payment_id,'allocation_cents',v_amount,
    'unapplied_cents',v_unapplied,
    'payment_status',case when v_unapplied=0 then 'posted' else 'partially_applied' end,
    'claim_status',v_claim_status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_payment(p_tenant_id uuid, p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment public.payments%rowtype;
  v_reversed_at timestamptz := now();
  v_claim_id uuid;
  v_claim public.professional_claims%rowtype;
  v_paid bigint;
  v_reducing bigint;
  v_recovery bigint;
  v_open bigint;
  v_financial_status public.claim_status_enum;
  v_allocation_count integer := 0;
  v_entries jsonb := '[]'::jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if p_payment_id is null then raise exception 'Payment is required.'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Reversal reason is required.'; end if;

  select * into v_payment
  from public.payments
  where id=p_payment_id and tenant_id=p_tenant_id
  for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_payment.payment_status in ('reversed','voided') then raise exception 'Payment is already reversed or voided.'; end if;

  insert into public.payment_reversals (tenant_id,payment_id,reason,reversed_by)
  values (p_tenant_id,p_payment_id,trim(p_reason),auth.uid());

  update public.payment_allocations
  set reversed_at=v_reversed_at, updated_at=v_reversed_at
  where payment_id=p_payment_id and tenant_id=p_tenant_id and reversed_at is null;
  get diagnostics v_allocation_count = row_count;

  update public.payments
  set payment_status='reversed'::public.payment_status_enum, updated_at=v_reversed_at
  where id=p_payment_id and tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'account_code',la.account_code,
    'side',case when le.side='debit'::public.ledger_side_enum then 'credit' else 'debit' end,
    'entry_type','reversal',
    'amount_cents',le.amount_cents,
    'client_id',le.client_id,
    'claim_id',le.claim_id,
    'payer_id',le.payer_id,
    'description','Payment reversal: ' || trim(p_reason)
  )),'[]'::jsonb)
  into v_entries
  from public.ledger_entries le
  join public.ledger_transactions lt on lt.id=le.ledger_transaction_id and lt.tenant_id=le.tenant_id
  join public.ledger_accounts la on la.id=le.ledger_account_id and la.tenant_id=le.tenant_id
  where le.tenant_id=p_tenant_id
    and lt.source_id=p_payment_id
    and lt.source_type in ('payment_receipt','payment_allocation');

  if jsonb_array_length(v_entries)>0 then
    perform public.create_ledger_transaction(
      p_tenant_id,'payment_reversal',p_payment_id,
      'Payment reversal: ' || trim(p_reason),v_entries,current_date
    );
  end if;

  for v_claim_id in
    select distinct claim_id
    from public.payment_allocations
    where payment_id=p_payment_id and tenant_id=p_tenant_id
      and reversed_at=v_reversed_at and claim_id is not null
  loop
    select * into v_claim
    from public.professional_claims
    where id=v_claim_id and tenant_id=p_tenant_id
    for update;
    if not found then continue; end if;

    select coalesce(sum(amount_cents),0) into v_paid
    from public.payment_allocations
    where claim_id=v_claim_id and tenant_id=p_tenant_id and reversed_at is null;

    select
      coalesce(sum(case when adjustment_type not in ('recoupment','refund_correction') then amount_cents else 0 end),0),
      coalesce(sum(case when adjustment_type in ('recoupment','refund_correction') then amount_cents else 0 end),0)
    into v_reducing,v_recovery
    from public.adjustments
    where claim_id=v_claim_id and tenant_id=p_tenant_id
      and adjustment_status not in ('reversed','voided');

    v_open := greatest(0,v_claim.total_charge_cents-v_paid-v_reducing+v_recovery);
    v_financial_status := case
      when v_open=0 then 'paid'::public.claim_status_enum
      when coalesce((v_claim.metadata->>'insurance_responsibility_cents')::bigint,0)=0
        and coalesce((v_claim.metadata->>'patient_responsibility_cents')::bigint,0)>0
        then 'patient_responsibility'::public.claim_status_enum
      when v_paid>0 or v_reducing>0 or v_recovery>0 then 'partially_paid'::public.claim_status_enum
      else 'accepted'::public.claim_status_enum end;

    if v_claim.claim_status in ('accepted','partially_paid','patient_responsibility','paid') then
      update public.professional_claims
      set claim_status=v_financial_status,
          paid_at=case when v_financial_status='paid' then coalesce(paid_at,v_reversed_at) else null end,
          updated_at=v_reversed_at
      where id=v_claim_id and tenant_id=p_tenant_id;
    end if;

    perform public.recalculate_claim_balance_summary(v_claim_id);
    perform public.recalculate_client_balance_summary(v_claim.client_id);
  end loop;

  if v_payment.client_id is not null then
    perform public.recalculate_client_balance_summary(v_payment.client_id);
  end if;

  return jsonb_build_object(
    'payment_id',p_payment_id,'payment_status','reversed',
    'reversed_at',v_reversed_at,'allocation_count',v_allocation_count
  );
end;
$function$;

revoke all on function public.post_manual_payment(uuid,bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text) from public, anon;
grant execute on function public.post_manual_payment(uuid,bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text) to authenticated, service_role;

revoke all on function public.allocate_payment(uuid,uuid,uuid,bigint) from public, anon;
grant execute on function public.allocate_payment(uuid,uuid,uuid,bigint) to authenticated, service_role;

revoke all on function public.reverse_payment(uuid,uuid,text) from public, anon;
grant execute on function public.reverse_payment(uuid,uuid,text) to authenticated, service_role;
