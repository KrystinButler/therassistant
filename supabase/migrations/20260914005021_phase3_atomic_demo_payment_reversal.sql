-- Phase 3 demo-only payment reversal hardening.
-- Direct anonymous mutation is removed. The browser calls a public SECURITY INVOKER
-- wrapper, which delegates to a private SECURITY DEFINER transaction that is
-- explicitly restricted to synthetic demo tenants.

create schema if not exists private;

create or replace function private.reverse_demo_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_demo boolean;
  v_reversed_at timestamptz := now();
  v_claim_id uuid;
  v_claim public.professional_claims%rowtype;
  v_paid bigint;
  v_reducing bigint;
  v_recovery bigint;
  v_open bigint;
  v_financial_status public.claim_status_enum;
  v_allocation_count integer := 0;
begin
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
  for update;

  if not found then
    raise exception 'Payment not found.';
  end if;

  select coalesce((t.settings ->> 'demo')::boolean, false)
    into v_demo
  from public.tenants t
  where t.id = v_payment.tenant_id;

  if not coalesce(v_demo, false) then
    raise exception 'Demo payment reversal is limited to a synthetic demo tenant.';
  end if;

  if v_payment.payment_status in ('reversed'::public.payment_status_enum, 'voided'::public.payment_status_enum) then
    raise exception 'Payment is already reversed or voided.';
  end if;

  perform 1
  from public.payment_allocations pa
  where pa.payment_id = p_payment_id
    and pa.tenant_id = v_payment.tenant_id
    and pa.reversed_at is null
  for update;

  insert into public.payment_reversals (
    tenant_id,
    payment_id,
    reason,
    reversed_by
  ) values (
    v_payment.tenant_id,
    p_payment_id,
    trim(p_reason),
    null
  );

  update public.payment_allocations pa
  set reversed_at = v_reversed_at,
      updated_at = v_reversed_at
  where pa.payment_id = p_payment_id
    and pa.tenant_id = v_payment.tenant_id
    and pa.reversed_at is null;

  get diagnostics v_allocation_count = row_count;

  update public.payments p
  set payment_status = 'reversed'::public.payment_status_enum,
      updated_at = v_reversed_at
  where p.id = p_payment_id
    and p.tenant_id = v_payment.tenant_id;

  for v_claim_id in
    select distinct pa.claim_id
    from public.payment_allocations pa
    where pa.payment_id = p_payment_id
      and pa.tenant_id = v_payment.tenant_id
      and pa.reversed_at = v_reversed_at
      and pa.claim_id is not null
  loop
    select pc.*
      into v_claim
    from public.professional_claims pc
    where pc.id = v_claim_id
      and pc.tenant_id = v_payment.tenant_id
    for update;

    if not found then
      continue;
    end if;

    select coalesce(sum(pa.amount_cents), 0)
      into v_paid
    from public.payment_allocations pa
    where pa.claim_id = v_claim_id
      and pa.tenant_id = v_payment.tenant_id
      and pa.reversed_at is null;

    select
      coalesce(sum(case when a.adjustment_type not in (
        'recoupment'::public.adjustment_type_enum,
        'refund_correction'::public.adjustment_type_enum
      ) then a.amount_cents else 0 end), 0),
      coalesce(sum(case when a.adjustment_type in (
        'recoupment'::public.adjustment_type_enum,
        'refund_correction'::public.adjustment_type_enum
      ) then a.amount_cents else 0 end), 0)
      into v_reducing, v_recovery
    from public.adjustments a
    where a.claim_id = v_claim_id
      and a.tenant_id = v_payment.tenant_id
      and a.adjustment_status not in (
        'reversed'::public.adjustment_status_enum,
        'voided'::public.adjustment_status_enum
      );

    v_open := greatest(
      0,
      coalesce(v_claim.total_charge_cents, 0) - v_paid - v_reducing + v_recovery
    );

    v_financial_status := case
      when v_open = 0 then 'paid'::public.claim_status_enum
      when v_paid > 0 or v_reducing > 0 or v_recovery > 0 then 'partially_paid'::public.claim_status_enum
      else 'accepted'::public.claim_status_enum
    end;

    if v_claim.claim_status in (
      'accepted'::public.claim_status_enum,
      'partially_paid'::public.claim_status_enum,
      'paid'::public.claim_status_enum
    ) then
      update public.professional_claims pc
      set claim_status = v_financial_status,
          paid_at = case
            when v_financial_status = 'paid'::public.claim_status_enum then coalesce(pc.paid_at, v_reversed_at)
            else null
          end,
          updated_at = v_reversed_at
      where pc.id = v_claim_id;
    end if;
  end loop;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'payment_status', 'reversed',
    'reversed_at', v_reversed_at,
    'allocation_count', v_allocation_count
  );
end;
$$;

revoke all on function private.reverse_demo_payment(uuid, text) from public;
revoke all on function private.reverse_demo_payment(uuid, text) from anon;
revoke all on function private.reverse_demo_payment(uuid, text) from authenticated;
grant usage on schema private to anon;
grant execute on function private.reverse_demo_payment(uuid, text) to anon;

create or replace function public.reverse_demo_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reverse_demo_payment(p_payment_id, p_reason);
$$;

revoke all on function public.reverse_demo_payment(uuid, text) from public;
revoke all on function public.reverse_demo_payment(uuid, text) from anon;
revoke all on function public.reverse_demo_payment(uuid, text) from authenticated;
grant execute on function public.reverse_demo_payment(uuid, text) to anon;

revoke update (reversed_at) on table public.payment_allocations from anon;
revoke insert on table public.payment_reversals from anon;

drop policy if exists "demo anon payment allocations update" on public.payment_allocations;
drop policy if exists "demo anon payment reversals insert" on public.payment_reversals;
