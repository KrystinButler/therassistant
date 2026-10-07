alter table public.fee_schedules
  add column if not exists payer_id uuid null references public.payers(id),
  add column if not exists provider_level text null,
  add column if not exists is_reference boolean not null default false,
  add column if not exists source_name text null,
  add column if not exists source_note text null;

create index if not exists fee_schedules_tenant_payer_idx
  on public.fee_schedules (tenant_id, payer_id, status);

create or replace view public.v_fee_schedule_rates as
select
  fs.tenant_id,
  fs.id as fee_schedule_id,
  fs.name as fee_schedule_name,
  fs.status as fee_schedule_status,
  fs.effective_date,
  fs.termination_date,
  coalesce(pc.payer_id, fs.payer_id) as payer_id,
  py.name as payer_name,
  fsl.id as fee_schedule_line_id,
  fsl.cpt_code,
  fsl.modifier,
  fsl.rate_cents,
  fsl.unit_type,
  fsl.updated_at,
  fs.provider_level,
  fs.is_reference,
  fs.source_name
from public.fee_schedules fs
join public.fee_schedule_lines fsl
  on fsl.fee_schedule_id = fs.id
left join public.payer_contracts pc
  on pc.id = fs.payer_contract_id
left join public.payers py
  on py.id = coalesce(pc.payer_id, fs.payer_id);
