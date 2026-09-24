alter type public.charge_status_enum add value if not exists 'program_billing';

alter table public.encounters
  add column if not exists funding_source_type text,
  add column if not exists funding_source_subtype text,
  add column if not exists billing_path text,
  add column if not exists funding_context jsonb not null default '{}'::jsonb;

alter table public.encounters
  drop constraint if exists encounters_funding_source_type_check,
  add constraint encounters_funding_source_type_check
    check (funding_source_type is null or funding_source_type in ('insurance','government_program','private_pay')),
  drop constraint if exists encounters_billing_path_check,
  add constraint encounters_billing_path_check
    check (billing_path is null or billing_path in ('insurance_claim','program_invoice_voucher','private_pay'));

alter table public.charge_capture_items
  add column if not exists funding_source_type text,
  add column if not exists funding_source_subtype text,
  add column if not exists billing_path text,
  add column if not exists funding_context jsonb not null default '{}'::jsonb;

alter table public.charge_capture_items
  drop constraint if exists charge_capture_items_funding_source_type_check,
  add constraint charge_capture_items_funding_source_type_check
    check (funding_source_type is null or funding_source_type in ('insurance','government_program','private_pay')),
  drop constraint if exists charge_capture_items_billing_path_check,
  add constraint charge_capture_items_billing_path_check
    check (billing_path is null or billing_path in ('insurance_claim','program_invoice_voucher','private_pay'));

update public.encounters e
set
  funding_source_type = case when coalesce(c.metadata ->> 'billing_type', 'insurance') = 'self_pay' then 'private_pay' else 'insurance' end,
  billing_path = case when coalesce(c.metadata ->> 'billing_type', 'insurance') = 'self_pay' then 'private_pay' else 'insurance_claim' end
from public.clients c
where c.id = e.client_id
  and c.tenant_id = e.tenant_id
  and (e.funding_source_type is null or e.billing_path is null);

update public.charge_capture_items ch
set
  funding_source_type = coalesce(e.funding_source_type, case when ch.charge_status = 'patient_responsibility'::public.charge_status_enum then 'private_pay' else 'insurance' end),
  billing_path = coalesce(e.billing_path, case when ch.charge_status = 'patient_responsibility'::public.charge_status_enum then 'private_pay' else 'insurance_claim' end),
  funding_source_subtype = coalesce(ch.funding_source_subtype, e.funding_source_subtype),
  funding_context = case when ch.funding_context = '{}'::jsonb then coalesce(e.funding_context, '{}'::jsonb) else ch.funding_context end
from public.encounters e
where e.id = ch.encounter_id
  and e.tenant_id = ch.tenant_id
  and (ch.funding_source_type is null or ch.billing_path is null);

create index if not exists encounters_funding_path_idx
on public.encounters (tenant_id, billing_path, billing_status);

create index if not exists charge_capture_items_funding_path_idx
on public.charge_capture_items (tenant_id, billing_path, charge_status);
