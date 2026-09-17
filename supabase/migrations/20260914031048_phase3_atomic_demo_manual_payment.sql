-- Post a synthetic demo manual payment and its optional claim allocation in one
-- database transaction. Any exception rolls back the complete ledger change.

create schema if not exists private;

create or replace function private.post_demo_manual_payment(
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
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_claim public.professional_claims%rowtype;
  v_payment public.payments%rowtype;
  v_client_id uuid := p_client_id;
  v_payer_id uuid := p_payer_id;
  v_paid bigint := 0;
  v_reducing bigint := 0;
  v_recovery bigint := 0;
  v_open bigint := 0;
  v_allocation bigint := greatest(0, coalesce(p_allocation_cents, 0));
  v_status public.payment_status_enum;
  v_claim_status public.claim_status_enum;
begin
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_source not in ('insurance', 'patient', 'third_party', 'historical', 'transfer', 'refund', 'adjustment', 'other') then
    raise exception 'Payment source is invalid.';
  end if;
  if p_method not in ('eft', 'ach', 'check', 'credit_card', 'debit_card', 'cash', 'money_order', 'portal', 'manual', 'other') then
    raise exception 'Payment method is invalid.';
  end if;

  select t.id
    into v_tenant_id
  from public.tenants t
  where coalesce((t.settings ->> 'demo')::boolean, false)
  order by t.created_at
  limit 1;

  if v_tenant_id is null then
    raise exception 'Synthetic demo tenant was not found.';
  end if;

  if p_claim_id is not null then
    select pc.*
      into v_claim
    from public.professional_claims pc
    where pc.id = p_claim_id
      and pc.tenant_id = v_tenant_id
    for update;
    if not found then
      raise exception 'Selected claim was not found.';
    end if;

    v_client_id := v_claim.client_id;
    if p_source = 'insurance' then
      v_payer_id := v_claim.payer_id;
    else
      v_payer_id := null;
    end if;

    select coalesce(sum(pa.amount_cents), 0)
      into v_paid
    from public.payment_allocations pa
    where pa.claim_id = p_claim_id
      and pa.tenant_id = v_tenant_id
      and pa.reversed_at is null;

    select
      coalesce(sum(case when a.adjustment_type not in ('recoupment', 'refund_correction') then a.amount_cents else 0 end), 0),
      coalesce(sum(case when a.adjustment_type in ('recoupment', 'refund_correction') then a.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = p_claim_id
      and a.tenant_id = v_tenant_id
      and a.adjustment_status not in ('reversed', 'voided');

    v_open := greatest(0, coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery);
    v_allocation := least(v_allocation, v_open, p_amount_cents);
  else
    v_allocation := 0;
  end if;

  if p_source = 'patient' and v_client_id is null then
    raise exception 'Patient payments require a patient or a patient-owned claim.';
  end if;
  if p_source = 'insurance' and v_payer_id is null then
    raise exception 'Insurance payments require a payer or a payer-owned claim.';
  end if;
  if v_client_id is not null and not exists (
    select 1 from public.clients c where c.id = v_client_id and c.tenant_id = v_tenant_id
  ) then
    raise exception 'Selected patient is outside the synthetic demo tenant.';
  end if;

  v_status := case
    when v_allocation = 0 then 'unapplied'
    when v_allocation = p_amount_cents then 'posted'
    else 'partially_applied'
  end;

  insert into public.payments (
    tenant_id, client_id, payer_id, payment_source, payment_method,
    payment_status, payment_date, amount_cents, trace_number, check_number,
    notes, posted_at
  ) values (
    v_tenant_id, v_client_id, v_payer_id, p_source, p_method,
    v_status, current_date, p_amount_cents, nullif(trim(p_trace_number), ''),
    nullif(trim(p_check_number), ''), nullif(trim(p_notes), ''),
    case when v_allocation > 0 then now() else null end
  )
  returning * into v_payment;

  if p_claim_id is not null and v_allocation > 0 then
    insert into public.payment_allocations (
      tenant_id, payment_id, client_id, claim_id, amount_cents
    ) values (
      v_tenant_id, v_payment.id, v_client_id, p_claim_id, v_allocation
    );

    v_open := greatest(0, v_open - v_allocation);
    v_claim_status := case
      when v_open = 0 then 'paid'::public.claim_status_enum
      else 'partially_paid'::public.claim_status_enum
    end;

    if v_claim.claim_status in (
      'accepted'::public.claim_status_enum,
      'partially_paid'::public.claim_status_enum,
      'paid'::public.claim_status_enum
    ) then
      update public.professional_claims pc
      set claim_status = v_claim_status,
          paid_at = case when v_claim_status = 'paid'::public.claim_status_enum then now() else null end,
          updated_at = now()
      where pc.id = p_claim_id
        and pc.tenant_id = v_tenant_id;
    end if;
  end if;

  return to_jsonb(v_payment);
end;
$$;

revoke all on function private.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from public;
revoke all on function private.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from anon;
revoke all on function private.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from authenticated;
grant usage on schema private to anon;
grant execute on function private.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) to anon;

create or replace function public.post_demo_manual_payment(
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
language sql
security invoker
set search_path = ''
as $$
  select private.post_demo_manual_payment(
    p_amount_cents, p_source, p_method, p_client_id, p_payer_id, p_claim_id,
    p_allocation_cents, p_trace_number, p_check_number, p_notes
  );
$$;

revoke all on function public.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from public;
revoke all on function public.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from anon;
revoke all on function public.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) from authenticated;
grant execute on function public.post_demo_manual_payment(bigint, public.payment_source_enum, public.payment_method_enum, uuid, uuid, uuid, bigint, text, text, text) to anon;

