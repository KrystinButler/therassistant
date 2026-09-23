
begin;

create or replace function public.post_manual_payment(
  p_tenant_id uuid,
  p_amount_cents bigint,
  p_source public.payment_source_enum,
  p_method public.payment_method_enum,
  p_client_id uuid default null,
  p_payer_id uuid default null,
  p_claim_id uuid default null,
  p_allocation_cents bigint default 0,
  p_trace_number text default null,
  p_check_number text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
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
  v_status public.payment_status_enum;
  v_claim_status public.claim_status_enum;
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'User does not have write access to this tenant.';
  end if;

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
      and p.payment_status not in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum);

    select
      coalesce(sum(case
        when a.adjustment_type not in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then a.amount_cents else 0 end), 0),
      coalesce(sum(case
        when a.adjustment_type in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then a.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = p_claim_id
      and a.tenant_id = p_tenant_id
      and a.adjustment_status not in ('reversed'::public.adjustment_status_enum, 'voided'::public.adjustment_status_enum);

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
        and p.payment_status not in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum);

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
    raise exception 'Selected patient is outside this tenant.';
  end if;

  if v_payer_id is not null and not exists (
    select 1 from public.payers p where p.id = v_payer_id
  ) then
    raise exception 'Selected payer was not found.';
  end if;

  v_status := case
    when v_allocation = 0 then 'unapplied'::public.payment_status_enum
    when v_allocation = p_amount_cents then 'posted'::public.payment_status_enum
    else 'partially_applied'::public.payment_status_enum
  end;

  insert into public.payments (
    tenant_id, client_id, payer_id, payment_source, payment_method,
    payment_status, payment_date, amount_cents, trace_number, check_number,
    notes, posted_by, posted_at
  ) values (
    p_tenant_id, v_client_id, v_payer_id, p_source, p_method,
    v_status, current_date, p_amount_cents, nullif(trim(p_trace_number), ''),
    nullif(trim(p_check_number), ''), nullif(trim(p_notes), ''),
    auth.uid(), case when v_allocation > 0 then now() else null end
  )
  returning * into v_payment;

  if p_claim_id is not null and v_allocation > 0 then
    insert into public.payment_allocations (
      tenant_id, payment_id, client_id, claim_id, amount_cents
    ) values (
      p_tenant_id, v_payment.id, v_client_id, p_claim_id, v_allocation
    );

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
  end if;

  return to_jsonb(v_payment);
end;
$function$;

create or replace function public.reverse_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
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
  v_patient_responsibility bigint := 0;
  v_patient_paid bigint := 0;
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

  if v_payment.payment_status in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum) then
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
  );

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
    join public.payments p on p.id = pa.payment_id and p.tenant_id = pa.tenant_id
    where pa.claim_id = v_claim_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at is null
      and p.payment_status not in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum);

    select
      coalesce(sum(case
        when a.adjustment_type not in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then a.amount_cents else 0 end), 0),
      coalesce(sum(case
        when a.adjustment_type in ('recoupment'::public.adjustment_type_enum, 'refund_correction'::public.adjustment_type_enum)
          then a.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = v_claim_id
      and a.tenant_id = p_tenant_id
      and a.adjustment_status not in ('reversed'::public.adjustment_status_enum, 'voided'::public.adjustment_status_enum);

    v_open := greatest(0, coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery);

    select coalesce(sum(pa.amount_cents), 0)
      into v_patient_paid
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id and p.tenant_id = pa.tenant_id
    where pa.claim_id = v_claim_id
      and pa.tenant_id = p_tenant_id
      and pa.reversed_at is null
      and p.payment_source = 'patient'::public.payment_source_enum
      and p.payment_status not in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum);

    v_patient_responsibility := greatest(
      0,
      coalesce((v_claim.metadata ->> 'patient_responsibility_cents')::bigint, 0) - v_patient_paid
    );

    v_financial_status := case
      when v_open = 0 then 'paid'::public.claim_status_enum
      when v_patient_responsibility > 0
        and coalesce((v_claim.metadata ->> 'insurance_responsibility_cents')::bigint, 0) = 0
        then 'patient_responsibility'::public.claim_status_enum
      when v_paid > 0 or v_reducing > 0 or v_recovery > 0 then 'partially_paid'::public.claim_status_enum
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
          paid_at = case when v_financial_status = 'paid'::public.claim_status_enum then coalesce(pc.paid_at, v_reversed_at) else null end,
          updated_at = v_reversed_at
      where pc.id = v_claim_id
        and pc.tenant_id = p_tenant_id;
    end if;
  end loop;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'payment_status', 'reversed',
    'reversed_at', v_reversed_at,
    'allocation_count', v_allocation_count
  );
end;
$function$;

revoke all on function public.post_manual_payment(
  uuid,bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text
) from public;
revoke all on function public.reverse_payment(uuid,uuid,text) from public;

grant execute on function public.post_manual_payment(
  uuid,bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text
) to authenticated;
grant execute on function public.reverse_payment(uuid,uuid,text) to authenticated;

revoke execute on function public.post_demo_manual_payment(
  bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text
) from public, anon;
revoke execute on function public.reverse_demo_payment(uuid,text) from public, anon;

commit;
