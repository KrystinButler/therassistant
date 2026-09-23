create unique index if not exists crm_payment_plans_one_open_per_account_idx
on public.crm_payment_plans (account_id)
where status in ('draft','active','defaulted');

create or replace function public.crm_create_plan_atomic(
  p_account_id uuid,
  p_plan jsonb,
  p_installments jsonb,
  p_actor_email citext
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_snapshot jsonb;
begin
  perform 1 from public.crm_accounts where id = p_account_id;
  if not found then
    raise exception 'CRM account not found';
  end if;

  if exists (
    select 1 from public.crm_payment_plans
    where account_id = p_account_id
      and status in ('draft','active','defaulted')
  ) then
    raise exception 'An open payment plan already exists for this account';
  end if;

  insert into public.crm_payment_plans (
    account_id,status,balance_at_creation_cents,down_payment_cents,
    remaining_balance_cents,frequency,first_installment_date,
    installment_cents,installment_count,final_installment_cents,
    final_installment_date,grace_period_days,special_terms,
    agreement_status,agreement_version,created_by,updated_by
  )
  values (
    p_account_id,
    'draft',
    (p_plan->>'balance_at_creation_cents')::integer,
    (p_plan->>'down_payment_cents')::integer,
    (p_plan->>'remaining_balance_cents')::integer,
    p_plan->>'frequency',
    (p_plan->>'first_installment_date')::date,
    (p_plan->>'installment_cents')::integer,
    (p_plan->>'installment_count')::integer,
    (p_plan->>'final_installment_cents')::integer,
    (p_plan->>'final_installment_date')::date,
    coalesce((p_plan->>'grace_period_days')::integer,0),
    nullif(p_plan->>'special_terms',''),
    'not_generated',
    0,
    p_actor_email,
    p_actor_email
  )
  returning id into v_plan_id;

  insert into public.crm_installments (
    plan_id,sequence_number,due_date,amount_due_cents,amount_paid_cents,status
  )
  select
    v_plan_id,
    (item->>'sequence_number')::integer,
    (item->>'due_date')::date,
    (item->>'amount_due_cents')::integer,
    0,
    'upcoming'
  from jsonb_array_elements(p_installments) as item;

  select to_jsonb(p) || jsonb_build_object('schedule',p_installments)
  into v_snapshot
  from public.crm_payment_plans p
  where p.id = v_plan_id;

  insert into public.crm_payment_plan_versions (
    plan_id,version_number,snapshot,reason,created_by
  )
  values (v_plan_id,1,v_snapshot,'created',p_actor_email);

  update public.crm_accounts
  set status='payment_plan', updated_by=p_actor_email, updated_at=now()
  where id=p_account_id;

  insert into public.crm_activity (
    account_id,activity_type,summary,related_table,related_id,metadata,actor_email
  )
  values (
    p_account_id,
    'payment_plan_created',
    'Payment plan created with ' || jsonb_array_length(p_installments) || ' installments.',
    'crm_payment_plans',
    v_plan_id,
    jsonb_build_object(
      'downPaymentCents',(p_plan->>'down_payment_cents')::integer,
      'installmentCents',(p_plan->>'installment_cents')::integer,
      'frequency',p_plan->>'frequency'
    ),
    p_actor_email
  );

  return v_plan_id;
end;
$$;

revoke all on function public.crm_create_plan_atomic(uuid,jsonb,jsonb,citext) from public, anon, authenticated;
grant execute on function public.crm_create_plan_atomic(uuid,jsonb,jsonb,citext) to service_role;

create or replace function public.crm_modify_plan_atomic(
  p_plan_id uuid,
  p_patch jsonb,
  p_installments jsonb,
  p_actor_email citext
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan public.crm_payment_plans%rowtype;
  v_updated public.crm_payment_plans%rowtype;
  v_version integer;
  v_snapshot jsonb;
begin
  select * into v_plan
  from public.crm_payment_plans
  where id=p_plan_id
  for update;

  if not found then
    raise exception 'Payment plan not found';
  end if;

  if v_plan.status not in ('draft','active','defaulted') then
    raise exception 'Only an open payment plan can be modified';
  end if;

  delete from public.crm_installments
  where plan_id=p_plan_id
    and amount_paid_cents=0;

  insert into public.crm_installments (
    plan_id,sequence_number,due_date,amount_due_cents,amount_paid_cents,status
  )
  select
    p_plan_id,
    (item->>'sequence_number')::integer,
    (item->>'due_date')::date,
    (item->>'amount_due_cents')::integer,
    0,
    'upcoming'
  from jsonb_array_elements(p_installments) as item;

  update public.crm_payment_plans
  set
    status='draft',
    remaining_balance_cents=(p_patch->>'remaining_balance_cents')::integer,
    frequency=p_patch->>'frequency',
    first_installment_date=(p_patch->>'first_installment_date')::date,
    installment_cents=(p_patch->>'installment_cents')::integer,
    installment_count=(p_patch->>'installment_count')::integer,
    final_installment_cents=(p_patch->>'final_installment_cents')::integer,
    final_installment_date=(p_patch->>'final_installment_date')::date,
    grace_period_days=coalesce((p_patch->>'grace_period_days')::integer,0),
    special_terms=nullif(p_patch->>'special_terms',''),
    agreement_status='not_generated',
    agreement_version=greatest(agreement_version,0)+1,
    updated_by=p_actor_email,
    updated_at=now()
  where id=p_plan_id
  returning * into v_updated;

  select coalesce(max(version_number),0)+1
  into v_version
  from public.crm_payment_plan_versions
  where plan_id=p_plan_id;

  v_snapshot := to_jsonb(v_updated) || jsonb_build_object('schedule',p_installments);

  insert into public.crm_payment_plan_versions (
    plan_id,version_number,snapshot,reason,created_by
  )
  values (p_plan_id,v_version,v_snapshot,'modified',p_actor_email);

  insert into public.crm_activity (
    account_id,activity_type,summary,related_table,related_id,metadata,actor_email
  )
  values (
    v_plan.account_id,
    'payment_plan_modified',
    'Payment plan terms modified; a new signed agreement is required.',
    'crm_payment_plans',
    p_plan_id,
    jsonb_build_object('version',v_version),
    p_actor_email
  );

  return p_plan_id;
end;
$$;

revoke all on function public.crm_modify_plan_atomic(uuid,jsonb,jsonb,citext) from public, anon, authenticated;
grant execute on function public.crm_modify_plan_atomic(uuid,jsonb,jsonb,citext) to service_role;
