begin;

create or replace function public.post_era_payment_receipt(
  p_tenant_id uuid,
  p_payer_id uuid,
  p_amount_cents bigint,
  p_method public.payment_method_enum,
  p_payment_date date,
  p_trace_number text,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_payment public.payments%rowtype;
  v_entries jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'ERA payment amount must be greater than zero.';
  end if;
  if p_payer_id is null or not exists (
    select 1 from public.payers where id = p_payer_id
  ) then
    raise exception 'ERA payer is required.';
  end if;
  if nullif(trim(coalesce(p_trace_number, '')), '') is null then
    raise exception 'ERA trace number is required.';
  end if;
  if exists (
    select 1
    from public.payments
    where tenant_id = p_tenant_id
      and payment_source = 'insurance'::public.payment_source_enum
      and payer_id = p_payer_id
      and trace_number = trim(p_trace_number)
      and payment_status not in ('reversed','voided')
  ) then
    raise exception 'An active insurance payment with this payer and trace number already exists.';
  end if;

  insert into public.payments (
    tenant_id, client_id, payer_id, payment_source, payment_method,
    payment_status, payment_date, amount_cents, trace_number,
    notes, posted_by, posted_at
  ) values (
    p_tenant_id, null, p_payer_id, 'insurance'::public.payment_source_enum, p_method,
    'unapplied'::public.payment_status_enum,
    coalesce(p_payment_date, current_date),
    p_amount_cents,
    trim(p_trace_number),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(),
    null
  )
  returning * into v_payment;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'account_code','1010','side','debit','entry_type','insurance_payment',
      'amount_cents',p_amount_cents,'payer_id',p_payer_id,
      'description','ERA payment receipt'
    ),
    jsonb_build_object(
      'account_code','2110','side','credit','entry_type','insurance_payment',
      'amount_cents',p_amount_cents,'payer_id',p_payer_id,
      'description','Unapplied ERA payer funds'
    )
  );

  perform public.create_ledger_transaction(
    p_tenant_id,
    'payment_receipt',
    v_payment.id,
    'ERA payment receipt',
    v_entries,
    coalesce(p_payment_date, current_date)
  );

  return to_jsonb(v_payment);
end;
$function$;

create or replace function public.post_contractual_adjustment(
  p_tenant_id uuid,
  p_claim_id uuid,
  p_amount_cents bigint,
  p_adjustment_date date,
  p_reason text,
  p_carc_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_claim public.professional_claims%rowtype;
  v_adjustment public.adjustments%rowtype;
  v_entries jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Contractual adjustment amount must be greater than zero.';
  end if;

  select * into v_claim
  from public.professional_claims
  where id = p_claim_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Claim not found.';
  end if;

  insert into public.adjustments (
    tenant_id, client_id, claim_id, payer_id,
    adjustment_type, adjustment_status, adjustment_date,
    amount_cents, reason, carc_code, posted_at
  ) values (
    p_tenant_id, v_claim.client_id, v_claim.id, v_claim.payer_id,
    'contractual'::public.adjustment_type_enum,
    'posted'::public.adjustment_status_enum,
    coalesce(p_adjustment_date, current_date),
    p_amount_cents,
    coalesce(nullif(trim(coalesce(p_reason,'')),''), 'Contractual adjustment from ERA'),
    nullif(trim(coalesce(p_carc_code,'')),''),
    now()
  )
  returning * into v_adjustment;

  insert into public.adjustment_allocations (
    tenant_id, adjustment_id, client_id, claim_id, amount_cents
  ) values (
    p_tenant_id, v_adjustment.id, v_claim.client_id, v_claim.id, p_amount_cents
  );

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'account_code','4020','side','debit','entry_type','adjustment',
      'amount_cents',p_amount_cents,'client_id',v_claim.client_id,
      'claim_id',v_claim.id,'payer_id',v_claim.payer_id,
      'description','Contractual adjustment'
    ),
    jsonb_build_object(
      'account_code','1100','side','credit','entry_type','adjustment',
      'amount_cents',p_amount_cents,'client_id',v_claim.client_id,
      'claim_id',v_claim.id,'payer_id',v_claim.payer_id,
      'description','Reduce accounts receivable for contractual adjustment'
    )
  );

  perform public.create_ledger_transaction(
    p_tenant_id,
    'adjustment',
    v_adjustment.id,
    'Contractual adjustment',
    v_entries,
    coalesce(p_adjustment_date, current_date)
  );

  perform public.recalculate_claim_balance_summary(v_claim.id);
  perform public.recalculate_client_balance_summary(v_claim.client_id);

  return to_jsonb(v_adjustment);
end;
$function$;

revoke all on function public.post_era_payment_receipt(uuid,uuid,bigint,public.payment_method_enum,date,text,text) from public, anon;
grant execute on function public.post_era_payment_receipt(uuid,uuid,bigint,public.payment_method_enum,date,text,text) to authenticated, service_role;

revoke all on function public.post_contractual_adjustment(uuid,uuid,bigint,date,text,text) from public, anon;
grant execute on function public.post_contractual_adjustment(uuid,uuid,bigint,date,text,text) to authenticated, service_role;

commit;
