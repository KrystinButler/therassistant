-- Reference data, tenant setup helpers, and operational reporting views.

-- Natural-key indexes for idempotent setup and seed migrations.
create unique index if not exists uq_payers_normalized_name
  on public.payers (lower(coalesce(normalized_name, name)));

create unique index if not exists uq_payer_plans_payer_name_type
  on public.payer_plans (payer_id, lower(name), coalesce(plan_type, ''));

create unique index if not exists uq_accounting_periods_tenant_dates
  on public.accounting_periods (tenant_id, start_date, end_date);

create unique index if not exists uq_providers_tenant_individual_npi
  on public.providers (tenant_id, individual_npi)
  where individual_npi is not null;

create unique index if not exists uq_fee_schedule_lines_lookup
  on public.fee_schedule_lines (fee_schedule_id, cpt_code, coalesce(modifier, ''));

create index if not exists idx_payer_aliases_alias_lower
  on public.payer_aliases (lower(alias));

create index if not exists idx_provider_enrollments_status_due
  on public.provider_payer_enrollments (tenant_id, enrollment_status, termination_date, effective_date);

-- Non-PHI payer reference seeds. These are global read-only references for authenticated users.
with seed_payers(name, payer_type, clearinghouse_payer_id) as (
  values
    ('Medicare', 'government', null),
    ('Medicaid', 'government', null),
    ('Health First Colorado', 'government', null),
    ('UnitedHealthcare', 'commercial', null),
    ('Optum', 'commercial', null),
    ('Aetna', 'commercial', null),
    ('Cigna', 'commercial', null),
    ('Blue Cross Blue Shield', 'commercial', null),
    ('Carelon Behavioral Health', 'commercial', null),
    ('Colorado Access', 'medicaid_rae', null),
    ('Colorado Community Health Alliance', 'medicaid_rae', null),
    ('Northeast Health Partners', 'medicaid_rae', null),
    ('Rocky Mountain Health Plans', 'medicaid_rae', null),
    ('Denver Health Medical Plan', 'medicaid_rae', null),
    ('TRICARE', 'government', null)
)
insert into public.payers (name, payer_type, clearinghouse_payer_id)
select name, payer_type, clearinghouse_payer_id
from seed_payers
on conflict do nothing;

with seed_aliases(payer_normalized_name, alias) as (
  values
    ('health first colorado', 'Colorado Medicaid'),
    ('health first colorado', 'HCPF'),
    ('unitedhealthcare', 'UHC'),
    ('unitedhealthcare', 'United Health Care'),
    ('blue cross blue shield', 'BCBS'),
    ('blue cross blue shield', 'Anthem'),
    ('carelon behavioral health', 'Carelon'),
    ('carelon behavioral health', 'Beacon'),
    ('colorado access', 'CO Access'),
    ('colorado access', 'CoAccess'),
    ('colorado community health alliance', 'CCHA'),
    ('northeast health partners', 'NHP'),
    ('rocky mountain health plans', 'RMHP'),
    ('denver health medical plan', 'Denver Health Medicaid Choice'),
    ('tricare', 'TriWest')
)
insert into public.payer_aliases (payer_id, alias, source)
select p.id, sa.alias, 'system_seed'
from seed_aliases sa
join public.payers p on lower(coalesce(p.normalized_name, p.name)) = sa.payer_normalized_name
on conflict (payer_id, alias) do nothing;

with seed_plans(payer_normalized_name, plan_name, plan_type) as (
  values
    ('health first colorado', 'Health First Colorado Medicaid', 'medicaid'),
    ('colorado access', 'Colorado Access RAE', 'medicaid_rae'),
    ('colorado community health alliance', 'CCHA RAE', 'medicaid_rae'),
    ('northeast health partners', 'Northeast Health Partners RAE', 'medicaid_rae'),
    ('rocky mountain health plans', 'RMHP RAE', 'medicaid_rae'),
    ('denver health medical plan', 'Denver Health Medicaid Choice', 'medicaid_mco'),
    ('medicare', 'Traditional Medicare', 'medicare'),
    ('tricare', 'TRICARE West', 'tricare')
)
insert into public.payer_plans (payer_id, name, plan_type)
select p.id, sp.plan_name, sp.plan_type
from seed_plans sp
join public.payers p on lower(coalesce(p.normalized_name, p.name)) = sp.payer_normalized_name
on conflict do nothing;

create or replace function public.setup_tenant_rcm_defaults(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_start_date date := date_trunc('month', current_date)::date;
  v_end_date date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_period_id uuid;
  v_ledger_count integer;
begin
  perform public.assert_tenant_access(p_tenant_id);
  perform public.ensure_default_ledger_accounts(p_tenant_id);

  insert into public.accounting_periods (
    tenant_id,
    period_name,
    start_date,
    end_date,
    status
  )
  values (
    p_tenant_id,
    to_char(v_start_date, 'YYYY-MM'),
    v_start_date,
    v_end_date,
    'open'
  )
  on conflict (tenant_id, start_date, end_date) do update
    set updated_at = now()
  returning id into v_period_id;

  select count(*) into v_ledger_count
  from public.ledger_accounts
  where tenant_id = p_tenant_id;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'ledger_account_count', v_ledger_count,
    'current_period_id', v_period_id,
    'current_period_start', v_start_date,
    'current_period_end', v_end_date
  );
end;
$$;

create or replace function public.upsert_provider(
  p_tenant_id uuid,
  p_first_name text,
  p_last_name text,
  p_credentials text default null,
  p_individual_npi text default null,
  p_taxonomy_code text default null,
  p_email text default null,
  p_phone text default null,
  p_provider_status provider_status_enum default 'active'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_provider_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
    raise exception 'Provider first_name and last_name are required';
  end if;

  if nullif(trim(p_individual_npi), '') is not null then
    insert into public.providers (
      tenant_id,
      first_name,
      last_name,
      credentials,
      individual_npi,
      taxonomy_code,
      email,
      phone,
      provider_status
    )
    values (
      p_tenant_id,
      trim(p_first_name),
      trim(p_last_name),
      nullif(trim(p_credentials), ''),
      nullif(trim(p_individual_npi), ''),
      nullif(trim(p_taxonomy_code), ''),
      nullif(trim(p_email), ''),
      nullif(trim(p_phone), ''),
      p_provider_status
    )
    on conflict (tenant_id, individual_npi) where individual_npi is not null do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          credentials = excluded.credentials,
          taxonomy_code = excluded.taxonomy_code,
          email = excluded.email,
          phone = excluded.phone,
          provider_status = excluded.provider_status,
          updated_at = now()
    returning id into v_provider_id;
  else
    insert into public.providers (
      tenant_id,
      first_name,
      last_name,
      credentials,
      taxonomy_code,
      email,
      phone,
      provider_status
    )
    values (
      p_tenant_id,
      trim(p_first_name),
      trim(p_last_name),
      nullif(trim(p_credentials), ''),
      nullif(trim(p_taxonomy_code), ''),
      nullif(trim(p_email), ''),
      nullif(trim(p_phone), ''),
      p_provider_status
    )
    returning id into v_provider_id;
  end if;

  return v_provider_id;
end;
$$;

create or replace function public.upsert_provider_enrollment(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_payer_name text,
  p_enrollment_status provider_enrollment_status_enum default 'not_started',
  p_payer_provider_id text default null,
  p_effective_date date default null,
  p_termination_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payer_id uuid;
  v_enrollment_id uuid;
begin
  perform public.assert_tenant_access(p_tenant_id);

  select id into v_payer_id
  from public.payers
  where lower(coalesce(normalized_name, name)) = lower(trim(p_payer_name))
     or id in (
       select payer_id
       from public.payer_aliases
       where lower(alias) = lower(trim(p_payer_name))
     )
  order by name
  limit 1;

  if v_payer_id is null then
    raise exception 'Payer reference not found: %', p_payer_name;
  end if;

  if not exists (
    select 1
    from public.providers
    where id = p_provider_id
      and tenant_id = p_tenant_id
  ) then
    raise exception 'Provider is not available in this tenant';
  end if;

  select id into v_enrollment_id
  from public.provider_payer_enrollments
  where tenant_id = p_tenant_id
    and provider_id = p_provider_id
    and payer_id = v_payer_id
  limit 1;

  if v_enrollment_id is null then
    insert into public.provider_payer_enrollments (
      tenant_id,
      provider_id,
      payer_id,
      enrollment_status,
      payer_provider_id,
      effective_date,
      termination_date,
      notes
    )
    values (
      p_tenant_id,
      p_provider_id,
      v_payer_id,
      p_enrollment_status,
      nullif(trim(p_payer_provider_id), ''),
      p_effective_date,
      p_termination_date,
      nullif(trim(p_notes), '')
    )
    returning id into v_enrollment_id;
  else
    update public.provider_payer_enrollments
    set enrollment_status = p_enrollment_status,
        payer_provider_id = nullif(trim(p_payer_provider_id), ''),
        effective_date = p_effective_date,
        termination_date = p_termination_date,
        notes = nullif(trim(p_notes), ''),
        updated_at = now()
    where id = v_enrollment_id
    returning id into v_enrollment_id;
  end if;

  return v_enrollment_id;
end;
$$;

create or replace function public.upsert_fee_schedule_rate(
  p_tenant_id uuid,
  p_fee_schedule_name text,
  p_cpt_code text,
  p_rate_cents integer,
  p_payer_name text default null,
  p_effective_date date default null,
  p_modifier text default null,
  p_unit_type text default 'session'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payer_id uuid;
  v_contract_id uuid;
  v_fee_schedule_id uuid;
  v_line_id uuid;
  v_schedule_name text := trim(p_fee_schedule_name);
  v_effective_date date := coalesce(p_effective_date, current_date);
begin
  perform public.assert_tenant_access(p_tenant_id);

  if nullif(v_schedule_name, '') is null then
    raise exception 'Fee schedule name is required';
  end if;

  if nullif(trim(p_cpt_code), '') is null then
    raise exception 'CPT code is required';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'Rate must be zero or greater';
  end if;

  if nullif(trim(p_payer_name), '') is not null then
    select id into v_payer_id
    from public.payers
    where lower(coalesce(normalized_name, name)) = lower(trim(p_payer_name))
       or id in (
         select payer_id
         from public.payer_aliases
         where lower(alias) = lower(trim(p_payer_name))
       )
    order by name
    limit 1;

    if v_payer_id is null then
      raise exception 'Payer reference not found: %', p_payer_name;
    end if;

    select id into v_contract_id
    from public.payer_contracts
    where tenant_id = p_tenant_id
      and payer_id = v_payer_id
      and lower(contract_name) = lower(v_schedule_name)
    limit 1;

    if v_contract_id is null then
      insert into public.payer_contracts (
        tenant_id,
        payer_id,
        contract_name,
        effective_date,
        status,
        notes
      )
      values (
        p_tenant_id,
        v_payer_id,
        v_schedule_name,
        v_effective_date,
        'active',
        'Created by upsert_fee_schedule_rate'
      )
      returning id into v_contract_id;
    end if;
  end if;

  select id into v_fee_schedule_id
  from public.fee_schedules
  where tenant_id = p_tenant_id
    and lower(name) = lower(v_schedule_name)
    and coalesce(payer_contract_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_contract_id, '00000000-0000-0000-0000-000000000000'::uuid)
  limit 1;

  if v_fee_schedule_id is null then
    insert into public.fee_schedules (
      tenant_id,
      payer_contract_id,
      name,
      effective_date,
      status
    )
    values (
      p_tenant_id,
      v_contract_id,
      v_schedule_name,
      v_effective_date,
      'active'
    )
    returning id into v_fee_schedule_id;
  end if;

  insert into public.fee_schedule_lines (
    tenant_id,
    fee_schedule_id,
    cpt_code,
    modifier,
    rate_cents,
    unit_type
  )
  values (
    p_tenant_id,
    v_fee_schedule_id,
    upper(trim(p_cpt_code)),
    nullif(upper(trim(p_modifier)), ''),
    p_rate_cents,
    nullif(trim(p_unit_type), '')
  )
  on conflict (fee_schedule_id, cpt_code, coalesce(modifier, '')) do update
    set rate_cents = excluded.rate_cents,
        unit_type = excluded.unit_type,
        updated_at = now()
  returning id into v_line_id;

  return v_line_id;
end;
$$;

create or replace function public.validate_tenant_setup(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.assert_tenant_access(p_tenant_id);

  select jsonb_build_object(
    'tenant_id', p_tenant_id,
    'ledger_accounts', (select count(*) from public.ledger_accounts where tenant_id = p_tenant_id),
    'providers', (select count(*) from public.providers where tenant_id = p_tenant_id),
    'clients', (select count(*) from public.clients where tenant_id = p_tenant_id and deleted_at is null),
    'active_insurance_policies', (select count(*) from public.client_insurance_policies where tenant_id = p_tenant_id and status = 'active'),
    'open_accounting_periods', (select count(*) from public.accounting_periods where tenant_id = p_tenant_id and status = 'open'),
    'open_workqueue_items', (select count(*) from public.workqueue_items where tenant_id = p_tenant_id and workqueue_status in ('open','in_progress','pending','snoozed')),
    'ready_for_batch_claims', (select count(*) from public.professional_claims where tenant_id = p_tenant_id and claim_status = 'ready_for_batch'),
    'open_denials', (select count(*) from public.denials where tenant_id = p_tenant_id and denial_status not in ('resolved_paid','resolved_writeoff','upheld','closed')),
    'reference_payers_visible', (select count(*) from public.payers),
    'missing_setup', jsonb_build_array()
  ) into v_result;

  if (v_result->>'ledger_accounts')::int < 8 then
    v_result := jsonb_set(v_result, '{missing_setup}', (v_result->'missing_setup') || jsonb_build_array('ledger_accounts'));
  end if;

  if (v_result->>'open_accounting_periods')::int = 0 then
    v_result := jsonb_set(v_result, '{missing_setup}', (v_result->'missing_setup') || jsonb_build_array('open_accounting_period'));
  end if;

  if (v_result->>'providers')::int = 0 then
    v_result := jsonb_set(v_result, '{missing_setup}', (v_result->'missing_setup') || jsonb_build_array('provider_roster'));
  end if;

  return v_result;
end;
$$;

-- Security-invoker operational views. These respect the caller's RLS policies.
create or replace view public.v_claim_ar
with (security_invoker = true)
as
select
  pc.tenant_id,
  pc.id as claim_id,
  pc.patient_control_number,
  pc.claim_status,
  pc.service_date_from,
  pc.service_date_to,
  pc.total_charge_cents,
  coalesce(cbs.paid_amount_cents, 0) as paid_amount_cents,
  coalesce(cbs.adjustment_amount_cents, 0) as adjustment_amount_cents,
  coalesce(cbs.open_balance_cents, pc.total_charge_cents) as open_balance_cents,
  greatest(current_date - coalesce(pc.service_date_to, pc.service_date_from, pc.created_at::date), 0) as age_days,
  case
    when coalesce(cbs.open_balance_cents, pc.total_charge_cents) <= 0 then 'closed_or_credit'
    when greatest(current_date - coalesce(pc.service_date_to, pc.service_date_from, pc.created_at::date), 0) <= 30 then '0_30'
    when greatest(current_date - coalesce(pc.service_date_to, pc.service_date_from, pc.created_at::date), 0) <= 60 then '31_60'
    when greatest(current_date - coalesce(pc.service_date_to, pc.service_date_from, pc.created_at::date), 0) <= 90 then '61_90'
    when greatest(current_date - coalesce(pc.service_date_to, pc.service_date_from, pc.created_at::date), 0) <= 120 then '91_120'
    else '120_plus'
  end as aging_bucket,
  pc.client_id,
  concat_ws(' ', c.first_name, c.last_name) as client_name,
  pc.payer_id,
  py.name as payer_name,
  pc.rendering_provider_id,
  concat_ws(' ', rp.first_name, rp.last_name) as rendering_provider_name,
  pc.submitted_at,
  pc.accepted_at,
  pc.paid_at,
  pc.updated_at
from public.professional_claims pc
join public.clients c on c.id = pc.client_id
left join public.claim_balance_summaries cbs on cbs.claim_id = pc.id
left join public.payers py on py.id = pc.payer_id
left join public.providers rp on rp.id = pc.rendering_provider_id;

create or replace view public.v_open_ar_summary
with (security_invoker = true)
as
select
  tenant_id,
  count(*) filter (where open_balance_cents > 0) as open_claim_count,
  coalesce(sum(open_balance_cents) filter (where open_balance_cents > 0), 0) as total_open_ar_cents,
  coalesce(sum(open_balance_cents) filter (where aging_bucket = '0_30'), 0) as ar_0_30_cents,
  coalesce(sum(open_balance_cents) filter (where aging_bucket = '31_60'), 0) as ar_31_60_cents,
  coalesce(sum(open_balance_cents) filter (where aging_bucket = '61_90'), 0) as ar_61_90_cents,
  coalesce(sum(open_balance_cents) filter (where aging_bucket = '91_120'), 0) as ar_91_120_cents,
  coalesce(sum(open_balance_cents) filter (where aging_bucket = '120_plus'), 0) as ar_120_plus_cents
from public.v_claim_ar
where claim_status not in ('paid','voided','reversed')
group by tenant_id;

create or replace view public.v_charge_capture_workqueue
with (security_invoker = true)
as
select
  cc.tenant_id,
  cc.id as charge_id,
  cc.charge_status,
  cc.block_reason,
  cc.service_date,
  cc.cpt_code,
  cc.diagnosis_code,
  cc.charge_amount_cents,
  cc.client_id,
  concat_ws(' ', c.first_name, c.last_name) as client_name,
  cc.provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) as provider_name,
  cc.payer_id,
  py.name as payer_name,
  cc.appointment_id,
  cc.clinical_note_id,
  cc.updated_at
from public.charge_capture_items cc
join public.clients c on c.id = cc.client_id
left join public.providers pr on pr.id = cc.provider_id
left join public.payers py on py.id = cc.payer_id;

create or replace view public.v_open_workqueue
with (security_invoker = true)
as
select
  wi.tenant_id,
  wi.id as workqueue_item_id,
  wi.workqueue_type,
  wi.workqueue_status,
  wi.priority,
  wi.title,
  wi.description,
  wi.source_object_type,
  wi.source_object_id,
  wi.assigned_user_id,
  wi.due_date,
  case
    when wi.due_date is null then false
    else wi.due_date < current_date
  end as is_overdue,
  wi.created_at,
  wi.updated_at,
  coalesce(pc.client_id, cc.client_id, d.client_id,
    case when wi.source_object_type = 'client' then wi.source_object_id end
  ) as related_client_id,
  concat_ws(' ', c.first_name, c.last_name) as related_client_name,
  coalesce(pc.payer_id, cc.payer_id, d.payer_id) as related_payer_id,
  py.name as related_payer_name,
  coalesce(pc.id, d.claim_id) as related_claim_id,
  pc.patient_control_number
from public.workqueue_items wi
left join public.professional_claims pc
  on wi.source_object_type = 'claim'
 and pc.id = wi.source_object_id
left join public.charge_capture_items cc
  on wi.source_object_type = 'charge'
 and cc.id = wi.source_object_id
left join public.denials d
  on wi.source_object_type = 'denial'
 and d.id = wi.source_object_id
left join public.clients c
  on c.id = coalesce(pc.client_id, cc.client_id, d.client_id,
    case when wi.source_object_type = 'client' then wi.source_object_id end
  )
left join public.payers py
  on py.id = coalesce(pc.payer_id, cc.payer_id, d.payer_id)
where wi.workqueue_status in ('open','in_progress','pending','snoozed');

create or replace view public.v_denial_inventory
with (security_invoker = true)
as
select
  d.tenant_id,
  d.id as denial_id,
  d.denial_status,
  d.workability,
  d.denial_category,
  d.carc_code,
  d.rarc_code,
  d.reason,
  d.amount_cents,
  d.denial_date,
  d.claim_id,
  pc.patient_control_number,
  d.client_id,
  concat_ws(' ', c.first_name, c.last_name) as client_name,
  d.payer_id,
  py.name as payer_name,
  count(wi.id) filter (where wi.workqueue_status in ('open','in_progress','pending','snoozed')) as open_workqueue_count,
  d.updated_at
from public.denials d
left join public.professional_claims pc on pc.id = d.claim_id
left join public.clients c on c.id = d.client_id
left join public.payers py on py.id = d.payer_id
left join public.workqueue_items wi
  on wi.source_object_type = 'denial'
 and wi.source_object_id = d.id
group by d.tenant_id, d.id, pc.patient_control_number, c.first_name, c.last_name, py.name;

create or replace view public.v_payment_reconciliation
with (security_invoker = true)
as
select
  p.tenant_id,
  p.id as payment_id,
  p.payment_source,
  p.payment_method,
  p.payment_status,
  p.amount_cents,
  coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0) as allocated_amount_cents,
  p.amount_cents - coalesce(sum(pa.amount_cents) filter (where pa.reversed_at is null), 0) as unapplied_amount_cents,
  p.payment_date,
  p.trace_number,
  p.check_number,
  p.client_id,
  concat_ws(' ', c.first_name, c.last_name) as client_name,
  p.payer_id,
  py.name as payer_name,
  p.posted_at,
  p.updated_at
from public.payments p
left join public.payment_allocations pa on pa.payment_id = p.id
left join public.clients c on c.id = p.client_id
left join public.payers py on py.id = p.payer_id
group by p.tenant_id, p.id, c.first_name, c.last_name, py.name;

create or replace view public.v_provider_enrollment_matrix
with (security_invoker = true)
as
select
  ppe.tenant_id,
  ppe.id as enrollment_id,
  ppe.enrollment_status,
  ppe.effective_date,
  ppe.termination_date,
  ppe.payer_provider_id,
  ppe.notes,
  pr.id as provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) as provider_name,
  pr.credentials,
  pr.individual_npi,
  py.id as payer_id,
  py.name as payer_name,
  ppe.updated_at
from public.provider_payer_enrollments ppe
join public.providers pr on pr.id = ppe.provider_id
join public.payers py on py.id = ppe.payer_id;

create or replace view public.v_fee_schedule_rates
with (security_invoker = true)
as
select
  fs.tenant_id,
  fs.id as fee_schedule_id,
  fs.name as fee_schedule_name,
  fs.status as fee_schedule_status,
  fs.effective_date,
  fs.termination_date,
  pc.payer_id,
  py.name as payer_name,
  fsl.id as fee_schedule_line_id,
  fsl.cpt_code,
  fsl.modifier,
  fsl.rate_cents,
  fsl.unit_type,
  fsl.updated_at
from public.fee_schedules fs
join public.fee_schedule_lines fsl on fsl.fee_schedule_id = fs.id
left join public.payer_contracts pc on pc.id = fs.payer_contract_id
left join public.payers py on py.id = pc.payer_id;

create or replace view public.v_tenant_operating_kpis
with (security_invoker = true)
as
select
  t.id as tenant_id,
  t.name as tenant_name,
  (select count(*) from public.clients c where c.tenant_id = t.id and c.deleted_at is null) as client_count,
  (select count(*) from public.providers pr where pr.tenant_id = t.id and pr.provider_status = 'active') as active_provider_count,
  (select count(*) from public.professional_claims pc where pc.tenant_id = t.id and pc.claim_status = 'ready_for_batch') as ready_for_batch_claim_count,
  (select coalesce(sum(open_balance_cents), 0) from public.v_claim_ar ar where ar.tenant_id = t.id and ar.open_balance_cents > 0) as total_open_ar_cents,
  (select count(*) from public.v_open_workqueue wq where wq.tenant_id = t.id) as open_workqueue_count,
  (select count(*) from public.denials d where d.tenant_id = t.id and d.denial_status not in ('resolved_paid','resolved_writeoff','upheld','closed')) as open_denial_count,
  (select count(*) from public.v_payment_reconciliation pr where pr.tenant_id = t.id and pr.unapplied_amount_cents <> 0) as unreconciled_payment_count,
  now() as calculated_at
from public.tenants t;

grant select on
  public.v_claim_ar,
  public.v_open_ar_summary,
  public.v_charge_capture_workqueue,
  public.v_open_workqueue,
  public.v_denial_inventory,
  public.v_payment_reconciliation,
  public.v_provider_enrollment_matrix,
  public.v_fee_schedule_rates,
  public.v_tenant_operating_kpis
  to authenticated;

grant execute on function public.setup_tenant_rcm_defaults(uuid) to authenticated;
grant execute on function public.upsert_provider(uuid, text, text, text, text, text, text, text, provider_status_enum) to authenticated;
grant execute on function public.upsert_provider_enrollment(uuid, uuid, text, provider_enrollment_status_enum, text, date, date, text) to authenticated;
grant execute on function public.upsert_fee_schedule_rate(uuid, text, text, integer, text, date, text, text) to authenticated;
grant execute on function public.validate_tenant_setup(uuid) to authenticated;

