create or replace function public.crm_allocate_production_payment_atomic(
  p_account_id uuid,
  p_transaction_id uuid,
  p_amount_cents integer,
  p_actor_email citext,
  p_preferred_installment_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_remaining integer := p_amount_cents;
  v_allocate integer;
  v_new_paid integer;
  v_inst record;
begin
  if p_amount_cents <= 0 then raise exception 'Payment amount must be positive'; end if;

  perform 1
  from public.payment_desk_transactions
  where id=p_transaction_id
    and crm_account_id=p_account_id
    and square_status='COMPLETED'
    and square_environment='production'
  for update;
  if not found then raise exception 'Only completed production CRM payments can be allocated'; end if;

  if exists (
    select 1 from public.crm_activity
    where account_id=p_account_id
      and activity_type='payment'
      and related_table='payment_desk_transactions'
      and related_id=p_transaction_id
  ) then
    return coalesce((
      select sum(amount_cents)::integer
      from public.crm_payment_allocations
      where payment_transaction_id=p_transaction_id
    ),0);
  end if;

  select id into v_plan_id
  from public.crm_payment_plans
  where account_id=p_account_id and status='active'
  order by created_at desc
  limit 1
  for update;

  if v_plan_id is not null then
    for v_inst in
      select id,amount_due_cents,amount_paid_cents,status
      from public.crm_installments
      where plan_id=v_plan_id
        and status <> 'waived'
        and amount_paid_cents < amount_due_cents
      order by
        case when id=p_preferred_installment_id then 0 else 1 end,
        due_date,
        sequence_number
      for update
    loop
      exit when v_remaining <= 0;
      v_allocate := least(v_remaining,greatest(0,v_inst.amount_due_cents-v_inst.amount_paid_cents));
      if v_allocate > 0 then
        insert into public.crm_payment_allocations (
          payment_transaction_id,installment_id,amount_cents
        ) values (p_transaction_id,v_inst.id,v_allocate);

        v_new_paid := v_inst.amount_paid_cents+v_allocate;
        update public.crm_installments
        set amount_paid_cents=v_new_paid,
            status=case when v_new_paid >= amount_due_cents then 'paid' else 'partial' end,
            paid_at=case when v_new_paid >= amount_due_cents then now() else null end,
            updated_at=now()
        where id=v_inst.id;

        v_remaining := v_remaining-v_allocate;
      end if;
    end loop;
  end if;

  insert into public.crm_activity (
    account_id,activity_type,summary,related_table,related_id,metadata,actor_email
  )
  values (
    p_account_id,'payment',
    'Payment received: $' || to_char(p_amount_cents/100.0,'FM999999990.00') || '.',
    'payment_desk_transactions',p_transaction_id,
    jsonb_build_object(
      'amountCents',p_amount_cents,
      'allocatedCents',p_amount_cents-v_remaining,
      'unallocatedCents',v_remaining
    ),
    p_actor_email
  );

  return p_amount_cents-v_remaining;
end;
$$;

revoke all on function public.crm_allocate_production_payment_atomic(uuid,uuid,integer,citext,uuid)
from public, anon, authenticated;
grant execute on function public.crm_allocate_production_payment_atomic(uuid,uuid,integer,citext,uuid)
to service_role;
