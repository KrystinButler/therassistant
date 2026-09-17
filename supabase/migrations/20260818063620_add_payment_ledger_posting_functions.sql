create or replace function public.ensure_default_ledger_accounts(p_tenant_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.create_ledger_transaction(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_entries jsonb,
  p_transaction_date date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid;
  v_entry jsonb;
  v_account_id uuid;
  v_amount integer;
  v_debits integer := 0;
  v_credits integer := 0;
  v_side public.ledger_side_enum;
  v_entry_type public.ledger_entry_type_enum;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Ledger entries must be a non-empty JSON array';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) as e(value)
  loop
    v_amount := coalesce((v_entry ->> 'amount_cents')::integer, 0);
    v_side := (v_entry ->> 'side')::public.ledger_side_enum;

    if v_amount <= 0 then
      raise exception 'Ledger entry amount must be positive: %', v_entry;
    end if;

    if v_side = 'debit'::public.ledger_side_enum then
      v_debits := v_debits + v_amount;
    elsif v_side = 'credit'::public.ledger_side_enum then
      v_credits := v_credits + v_amount;
    end if;
  end loop;

  if v_debits <> v_credits then
    raise exception 'Ledger transaction is not balanced. Debits %, credits %', v_debits, v_credits;
  end if;

  insert into public.ledger_transactions (
    tenant_id,
    source_type,
    source_id,
    description,
    transaction_date,
    created_by
  ) values (
    p_tenant_id,
    nullif(trim(p_source_type), ''),
    p_source_id,
    nullif(trim(p_description), ''),
    coalesce(p_transaction_date, current_date),
    auth.uid()
  ) returning id into v_transaction_id;

  for v_entry in select value from jsonb_array_elements(p_entries) as e(value)
  loop
    select id into v_account_id
    from public.ledger_accounts
    where tenant_id = p_tenant_id
      and account_code = (v_entry ->> 'account_code')
    limit 1;

    if v_account_id is null then
      raise exception 'Ledger account code % does not exist for tenant %', v_entry ->> 'account_code', p_tenant_id;
    end if;

    v_entry_type := (v_entry ->> 'entry_type')::public.ledger_entry_type_enum;

    insert into public.ledger_entries (
      tenant_id,
      ledger_transaction_id,
      ledger_account_id,
      side,
      entry_type,
      amount_cents,
      posting_date,
      client_id,
      claim_id,
      payer_id,
      description
    ) values (
      p_tenant_id,
      v_transaction_id,
      v_account_id,
      (v_entry ->> 'side')::public.ledger_side_enum,
      v_entry_type,
      (v_entry ->> 'amount_cents')::integer,
      coalesce(p_transaction_date, current_date),
      nullif(v_entry ->> 'client_id', '')::uuid,
      nullif(v_entry ->> 'claim_id', '')::uuid,
      nullif(v_entry ->> 'payer_id', '')::uuid,
      nullif(v_entry ->> 'description', '')
    );
  end loop;

  return v_transaction_id;
end;
$$;

create or replace function public.post_claim_charge_to_ledger(p_claim_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_existing_transaction_id uuid;
begin
  select * into v_claim
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
  end if;

  perform public.assert_tenant_access(v_claim.tenant_id);

  if v_claim.total_charge_cents <= 0 then
    raise exception 'Cannot post zero-dollar claim charge to ledger';
  end if;

  select id into v_existing_transaction_id
  from public.ledger_transactions
  where tenant_id = v_claim.tenant_id
    and source_type = 'claim_charge'
    and source_id = v_claim.id
  order by created_at desc
  limit 1;

  if v_existing_transaction_id is not null then
    return v_existing_transaction_id;
  end if;

  return public.create_ledger_transaction(
    v_claim.tenant_id,
    'claim_charge',
    v_claim.id,
    'Claim charge posted to A/R',
    jsonb_build_array(
      jsonb_build_object(
        'account_code', '1100',
        'side', 'debit',
        'entry_type', 'charge',
        'amount_cents', v_claim.total_charge_cents,
        'client_id', v_claim.client_id,
        'claim_id', v_claim.id,
        'payer_id', v_claim.payer_id,
        'description', 'A/R charge'
      ),
      jsonb_build_object(
        'account_code', '4000',
        'side', 'credit',
        'entry_type', 'charge',
        'amount_cents', v_claim.total_charge_cents,
        'client_id', v_claim.client_id,
        'claim_id', v_claim.id,
        'payer_id', v_claim.payer_id,
        'description', 'Service revenue'
      )
    ),
    coalesce(v_claim.service_date_from, current_date)
  );
end;
$$;

create or replace function public.post_insurance_payment(
  p_claim_id uuid,
  p_amount_cents integer,
  p_payment_date date default current_date,
  p_payment_method public.payment_method_enum default 'eft'::public.payment_method_enum,
  p_trace_number text default null,
  p_check_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_payment_id uuid;
  v_open_balance integer;
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select * into v_claim
  from public.professional_claims
  where id = p_claim_id;

  if not found then
    raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
  end if;

  perform public.assert_tenant_access(v_claim.tenant_id);

  insert into public.payments (
    tenant_id,
    client_id,
    payer_id,
    amount_cents,
    payment_date,
    payment_method,
    payment_source,
    payment_status,
    trace_number,
    check_number,
    notes,
    posted_at,
    posted_by
  ) values (
    v_claim.tenant_id,
    v_claim.client_id,
    v_claim.payer_id,
    p_amount_cents,
    coalesce(p_payment_date, current_date),
    coalesce(p_payment_method, 'eft'::public.payment_method_enum),
    'insurance'::public.payment_source_enum,
    'posted'::public.payment_status_enum,
    nullif(trim(p_trace_number), ''),
    nullif(trim(p_check_number), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid()
  ) returning id into v_payment_id;

  insert into public.payment_allocations (
    tenant_id,
    payment_id,
    claim_id,
    client_id,
    amount_cents
  ) values (
    v_claim.tenant_id,
    v_payment_id,
    v_claim.id,
    v_claim.client_id,
    p_amount_cents
  );

  perform public.create_ledger_transaction(
    v_claim.tenant_id,
    'insurance_payment',
    v_payment_id,
    'Insurance payment posted',
    jsonb_build_array(
      jsonb_build_object('account_code', '1010', 'side', 'debit', 'entry_type', 'insurance_payment', 'amount_cents', p_amount_cents, 'client_id', v_claim.client_id, 'claim_id', v_claim.id, 'payer_id', v_claim.payer_id, 'description', 'Insurance cash receipt'),
      jsonb_build_object('account_code', '1100', 'side', 'credit', 'entry_type', 'insurance_payment', 'amount_cents', p_amount_cents, 'client_id', v_claim.client_id, 'claim_id', v_claim.id, 'payer_id', v_claim.payer_id, 'description', 'Reduce A/R')
    ),
    coalesce(p_payment_date, current_date)
  );

  perform public.recalculate_claim_balance_summary(v_claim.id);
  perform public.recalculate_client_balance_summary(v_claim.client_id);

  select open_balance_cents into v_open_balance
  from public.claim_balance_summaries
  where claim_id = v_claim.id;

  update public.professional_claims
  set claim_status = case
        when coalesce(v_open_balance, 0) <= 0 then 'paid'::public.claim_status_enum
        else 'partially_paid'::public.claim_status_enum
      end,
      paid_at = case when coalesce(v_open_balance, 0) <= 0 then now() else paid_at end,
      updated_at = now()
  where id = v_claim.id;

  return v_payment_id;
end;
$$;

create or replace function public.post_patient_payment(
  p_tenant_id uuid,
  p_client_id uuid,
  p_amount_cents integer,
  p_claim_id uuid default null,
  p_payment_date date default current_date,
  p_payment_method public.payment_method_enum default 'credit_card'::public.payment_method_enum,
  p_trace_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_tenant_id uuid := p_tenant_id;
  v_client_id uuid := p_client_id;
  v_payer_id uuid;
  v_payment_id uuid;
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  if p_claim_id is not null then
    select * into v_claim
    from public.professional_claims
    where id = p_claim_id;

    if not found then
      raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
    end if;

    v_tenant_id := v_claim.tenant_id;
    v_client_id := v_claim.client_id;
    v_payer_id := v_claim.payer_id;
  end if;

  perform public.assert_tenant_access(v_tenant_id);

  if v_client_id is null then
    raise exception 'Client id is required';
  end if;

  insert into public.payments (
    tenant_id,
    client_id,
    payer_id,
    amount_cents,
    payment_date,
    payment_method,
    payment_source,
    payment_status,
    trace_number,
    notes,
    posted_at,
    posted_by
  ) values (
    v_tenant_id,
    v_client_id,
    v_payer_id,
    p_amount_cents,
    coalesce(p_payment_date, current_date),
    coalesce(p_payment_method, 'credit_card'::public.payment_method_enum),
    'patient'::public.payment_source_enum,
    'posted'::public.payment_status_enum,
    nullif(trim(p_trace_number), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid()
  ) returning id into v_payment_id;

  if p_claim_id is not null then
    insert into public.payment_allocations (tenant_id, payment_id, claim_id, client_id, amount_cents)
    values (v_tenant_id, v_payment_id, p_claim_id, v_client_id, p_amount_cents);
  end if;

  perform public.create_ledger_transaction(
    v_tenant_id,
    'patient_payment',
    v_payment_id,
    'Patient payment posted',
    jsonb_build_array(
      jsonb_build_object('account_code', '1010', 'side', 'debit', 'entry_type', 'patient_payment', 'amount_cents', p_amount_cents, 'client_id', v_client_id, 'claim_id', p_claim_id, 'payer_id', v_payer_id, 'description', 'Patient cash receipt'),
      jsonb_build_object('account_code', case when p_claim_id is null then '2100' else '1100' end, 'side', 'credit', 'entry_type', 'patient_payment', 'amount_cents', p_amount_cents, 'client_id', v_client_id, 'claim_id', p_claim_id, 'payer_id', v_payer_id, 'description', case when p_claim_id is null then 'Unapplied patient credit' else 'Reduce A/R' end)
    ),
    coalesce(p_payment_date, current_date)
  );

  if p_claim_id is not null then
    perform public.recalculate_claim_balance_summary(p_claim_id);
  end if;
  perform public.recalculate_client_balance_summary(v_client_id);

  return v_payment_id;
end;
$$;

create or replace function public.post_adjustment(
  p_adjustment_type public.adjustment_type_enum,
  p_amount_cents integer,
  p_claim_id uuid default null,
  p_client_id uuid default null,
  p_tenant_id uuid default null,
  p_payer_id uuid default null,
  p_carc_code text default null,
  p_reason text default null,
  p_adjustment_date date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claim public.professional_claims%rowtype;
  v_tenant_id uuid := p_tenant_id;
  v_client_id uuid := p_client_id;
  v_payer_id uuid := p_payer_id;
  v_adjustment_id uuid;
  v_debit_account text := '4020';
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Adjustment amount must be positive';
  end if;

  if p_claim_id is not null then
    select * into v_claim
    from public.professional_claims
    where id = p_claim_id;

    if not found then
      raise exception 'Claim % was not found or is not visible to the current user', p_claim_id;
    end if;

    v_tenant_id := v_claim.tenant_id;
    v_client_id := v_claim.client_id;
    v_payer_id := coalesce(v_claim.payer_id, p_payer_id);
  end if;

  perform public.assert_tenant_access(v_tenant_id);

  if v_client_id is null then
    raise exception 'Client id is required when adjustment is not claim-specific';
  end if;

  if p_adjustment_type in ('bad_debt'::public.adjustment_type_enum, 'patient_writeoff'::public.adjustment_type_enum) then
    v_debit_account := '4030';
  elsif p_adjustment_type in ('refund_correction'::public.adjustment_type_enum, 'recoupment'::public.adjustment_type_enum) then
    v_debit_account := '4050';
  end if;

  insert into public.adjustments (
    tenant_id,
    claim_id,
    client_id,
    payer_id,
    adjustment_type,
    adjustment_status,
    amount_cents,
    adjustment_date,
    carc_code,
    reason,
    posted_at,
    posted_by
  ) values (
    v_tenant_id,
    p_claim_id,
    v_client_id,
    v_payer_id,
    p_adjustment_type,
    'posted'::public.adjustment_status_enum,
    p_amount_cents,
    coalesce(p_adjustment_date, current_date),
    nullif(trim(p_carc_code), ''),
    nullif(trim(p_reason), ''),
    now(),
    auth.uid()
  ) returning id into v_adjustment_id;

  insert into public.adjustment_allocations (tenant_id, adjustment_id, claim_id, client_id, amount_cents)
  values (v_tenant_id, v_adjustment_id, p_claim_id, v_client_id, p_amount_cents);

  perform public.create_ledger_transaction(
    v_tenant_id,
    'adjustment',
    v_adjustment_id,
    'Adjustment posted',
    jsonb_build_array(
      jsonb_build_object('account_code', v_debit_account, 'side', 'debit', 'entry_type', 'adjustment', 'amount_cents', p_amount_cents, 'client_id', v_client_id, 'claim_id', p_claim_id, 'payer_id', v_payer_id, 'description', coalesce(nullif(trim(p_reason), ''), p_adjustment_type::text)),
      jsonb_build_object('account_code', '1100', 'side', 'credit', 'entry_type', 'adjustment', 'amount_cents', p_amount_cents, 'client_id', v_client_id, 'claim_id', p_claim_id, 'payer_id', v_payer_id, 'description', 'Reduce A/R')
    ),
    coalesce(p_adjustment_date, current_date)
  );

  if p_claim_id is not null then
    perform public.recalculate_claim_balance_summary(p_claim_id);
  end if;
  perform public.recalculate_client_balance_summary(v_client_id);

  return v_adjustment_id;
end;
$$;

create or replace function public.post_historical_transaction(
  p_tenant_id uuid,
  p_client_id uuid,
  p_transaction_type public.historical_transaction_type_enum,
  p_amount_cents integer,
  p_transaction_date date default current_date,
  p_payer_id uuid default null,
  p_claim_id uuid default null,
  p_description text default null,
  p_legacy_source text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_historical_transaction_id uuid;
  v_debit_account text;
  v_credit_account text;
  v_entry_type public.ledger_entry_type_enum;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_client_id is null then
    raise exception 'Client id is required';
  end if;

  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Historical transaction amount must be positive';
  end if;

  insert into public.historical_transactions (
    tenant_id,
    client_id,
    payer_id,
    transaction_type,
    transaction_status,
    amount_cents,
    transaction_date,
    description,
    legacy_source,
    posted_at,
    posted_by
  ) values (
    p_tenant_id,
    p_client_id,
    p_payer_id,
    p_transaction_type,
    'posted'::public.historical_transaction_status_enum,
    p_amount_cents,
    coalesce(p_transaction_date, current_date),
    nullif(trim(p_description), ''),
    nullif(trim(p_legacy_source), ''),
    now(),
    auth.uid()
  ) returning id into v_historical_transaction_id;

  if p_claim_id is not null then
    insert into public.historical_transaction_allocations (tenant_id, historical_transaction_id, claim_id, amount_cents)
    values (p_tenant_id, v_historical_transaction_id, p_claim_id, p_amount_cents);
  end if;

  if p_transaction_type = 'opening_balance'::public.historical_transaction_type_enum then
    v_debit_account := '1100';
    v_credit_account := '3000';
    v_entry_type := 'opening_balance'::public.ledger_entry_type_enum;
  elsif p_transaction_type = 'payment'::public.historical_transaction_type_enum then
    v_debit_account := '1010';
    v_credit_account := '1100';
    v_entry_type := 'insurance_payment'::public.ledger_entry_type_enum;
  elsif p_transaction_type in ('adjustment'::public.historical_transaction_type_enum, 'credit'::public.historical_transaction_type_enum, 'correction'::public.historical_transaction_type_enum) then
    v_debit_account := '4020';
    v_credit_account := '1100';
    v_entry_type := 'adjustment'::public.ledger_entry_type_enum;
  elsif p_transaction_type = 'refund'::public.historical_transaction_type_enum then
    v_debit_account := '2100';
    v_credit_account := '1010';
    v_entry_type := 'refund'::public.ledger_entry_type_enum;
  else
    v_debit_account := '1100';
    v_credit_account := '3000';
    v_entry_type := 'correction'::public.ledger_entry_type_enum;
  end if;

  perform public.create_ledger_transaction(
    p_tenant_id,
    'historical_transaction',
    v_historical_transaction_id,
    coalesce(nullif(trim(p_description), ''), 'Historical ' || p_transaction_type::text),
    jsonb_build_array(
      jsonb_build_object('account_code', v_debit_account, 'side', 'debit', 'entry_type', v_entry_type, 'amount_cents', p_amount_cents, 'client_id', p_client_id, 'claim_id', p_claim_id, 'payer_id', p_payer_id, 'description', coalesce(nullif(trim(p_description), ''), 'Historical debit')),
      jsonb_build_object('account_code', v_credit_account, 'side', 'credit', 'entry_type', v_entry_type, 'amount_cents', p_amount_cents, 'client_id', p_client_id, 'claim_id', p_claim_id, 'payer_id', p_payer_id, 'description', coalesce(nullif(trim(p_description), ''), 'Historical credit'))
    ),
    coalesce(p_transaction_date, current_date)
  );

  if p_claim_id is not null then
    perform public.recalculate_claim_balance_summary(p_claim_id);
  end if;
  perform public.recalculate_client_balance_summary(p_client_id);

  return v_historical_transaction_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'ensure_default_ledger_accounts',
        'create_ledger_transaction',
        'post_claim_charge_to_ledger',
        'post_insurance_payment',
        'post_patient_payment',
        'post_adjustment',
        'post_historical_transaction',
        'recalculate_claim_balance_summary',
        'recalculate_client_balance_summary'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon', r.nspname, r.proname, r.args);
    execute format('grant execute on function %I.%I(%s) to authenticated', r.nspname, r.proname, r.args);
  end loop;
end $$;
