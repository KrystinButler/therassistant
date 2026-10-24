-- Restore verified missing objects whose historical migrations are already recorded as applied.
-- Additive and rerunnable; preserve existing clinical and financial records.
create table if not exists public.specialty_program_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  status text not null default 'active'
    check (status in ('draft','active','inactive','archived')),
  version integer not null default 1 check (version > 0),
  effective_from date,
  effective_to date,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint specialty_program_templates_effective_dates
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (id, tenant_id)
);

create unique index if not exists specialty_program_templates_tenant_name_uidx
on public.specialty_program_templates (tenant_id, lower(name));

create index if not exists specialty_program_templates_tenant_status_idx
on public.specialty_program_templates (tenant_id, status, category, name);

create table if not exists public.specialty_program_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,
  item_type text not null
    check (item_type in (
      'documentation_requirement',
      'assessment',
      'progress_measure',
      'reporting_requirement',
      'milestone',
      'form'
    )),
  item_key text not null,
  label text not null,
  description text,
  is_required boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint specialty_program_template_items_template_tenant_fkey
    foreign key (template_id, tenant_id)
    references public.specialty_program_templates(id, tenant_id)
    on delete cascade
);

create unique index if not exists specialty_program_template_items_key_uidx
on public.specialty_program_template_items (template_id, lower(item_key));

create index if not exists specialty_program_template_items_order_idx
on public.specialty_program_template_items (tenant_id, template_id, sort_order, item_type);

alter table public.specialty_program_templates enable row level security;
alter table public.specialty_program_template_items enable row level security;

revoke all on table public.specialty_program_templates from anon;
revoke all on table public.specialty_program_template_items from anon;
revoke all on table public.specialty_program_templates from authenticated;
revoke all on table public.specialty_program_template_items from authenticated;

grant select, insert, update, delete on table public.specialty_program_templates to authenticated;
grant select, insert, update, delete on table public.specialty_program_template_items to authenticated;

drop policy if exists specialty_program_templates_select on public.specialty_program_templates;
create policy specialty_program_templates_select
on public.specialty_program_templates for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

drop policy if exists specialty_program_templates_insert on public.specialty_program_templates;
create policy specialty_program_templates_insert
on public.specialty_program_templates for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists specialty_program_templates_update on public.specialty_program_templates;
create policy specialty_program_templates_update
on public.specialty_program_templates for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists specialty_program_templates_delete on public.specialty_program_templates;
create policy specialty_program_templates_delete
on public.specialty_program_templates for delete
to authenticated
using (private.has_tenant_write_access(tenant_id));

drop policy if exists specialty_program_template_items_select on public.specialty_program_template_items;
create policy specialty_program_template_items_select
on public.specialty_program_template_items for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

drop policy if exists specialty_program_template_items_insert on public.specialty_program_template_items;
create policy specialty_program_template_items_insert
on public.specialty_program_template_items for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists specialty_program_template_items_update on public.specialty_program_template_items;
create policy specialty_program_template_items_update
on public.specialty_program_template_items for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists specialty_program_template_items_delete on public.specialty_program_template_items;
create policy specialty_program_template_items_delete
on public.specialty_program_template_items for delete
to authenticated
using (private.has_tenant_write_access(tenant_id));

insert into public.specialty_program_templates
  (tenant_id, name, category, description, status, settings)
select
  t.id,
  seed.name,
  seed.category,
  seed.description,
  'active',
  jsonb_build_object('starter_template', true)
from public.tenants t
cross join (
  values
    ('Probation Program', 'probation', 'Configurable treatment and reporting template for probation-referred care.'),
    ('DUI Program', 'dui', 'Configurable template for DUI-related treatment, assessment, and reporting workflows.'),
    ('Domestic Violence Program', 'domestic_violence', 'Configurable template for domestic-violence specialty treatment workflows.'),
    ('Sex-Offender Treatment Program', 'sex_offender', 'Configurable specialty template for sex-offender treatment program requirements.'),
    ('Substance Use Program', 'substance_use', 'Configurable template for substance-use treatment documentation and progress requirements.'),
    ('Court Evaluation Program', 'court_evaluation', 'Configurable template for court-ordered or court-related evaluation workflows.'),
    ('Ketamine-Assisted Program', 'ketamine_assisted', 'Configurable template for ketamine-assisted treatment documentation and program requirements.'),
    ('Psychedelic-Assisted Program', 'psychedelic_assisted', 'Configurable template for psychedelic-assisted treatment documentation and program requirements.')
) as seed(name, category, description)
where t.status = 'active'
on conflict do nothing;

insert into public.specialty_program_template_items
  (tenant_id, template_id, item_type, item_key, label, description, is_required, sort_order)
select
  p.tenant_id,
  p.id,
  seed.item_type,
  seed.item_key,
  seed.label,
  seed.description,
  false,
  seed.sort_order
from public.specialty_program_templates p
cross join (
  values
    ('documentation_requirement', 'documentation', 'Documentation requirements', 'Configure required note sections, documentation elements, or supporting records.', 10),
    ('assessment', 'assessments', 'Assessments', 'Configure assessment names, timing, score/result references, or completion expectations.', 20),
    ('progress_measure', 'progress_measures', 'Progress measures', 'Configure the progress measures the practice wants tracked for this program.', 30),
    ('reporting_requirement', 'reporting', 'Reporting requirements', 'Configure authorized status reports, cadence, recipients, and minimum-necessary disclosure rules.', 40),
    ('milestone', 'milestones', 'Milestones', 'Configure program milestones, review points, or completion criteria.', 50),
    ('form', 'forms', 'Forms', 'Configure forms, acknowledgments, or documents associated with this program.', 60)
) as seed(item_type, item_key, label, description, sort_order)
where coalesce((p.settings ->> 'starter_template')::boolean, false)
on conflict do nothing;

create index if not exists specialty_program_template_items_template_tenant_idx
on public.specialty_program_template_items (template_id, tenant_id);

create index if not exists specialty_program_templates_created_by_idx
on public.specialty_program_templates (created_by)
where created_by is not null;

create or replace view public.v_client_profile_summary
with (security_invoker = true)
as
select
  c.tenant_id,
  c.id as client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  c.preferred_name,
  c.date_of_birth,
  c.client_status,
  c.registration_status,
  c.billing_readiness_status,
  c.email,
  c.phone,
  c.city,
  c.state,
  c.updated_at,
  count(distinct cip.id) filter (where cip.status = 'active') as active_policy_count,
  count(distinct cd.id) filter (where cd.diagnosis_status = 'active') as active_diagnosis_count,
  count(distinct tp.id) filter (where tp.status in ('active','signed')) as active_treatment_plan_count,
  coalesce(cbs.open_balance_cents, 0) as open_balance_cents,
  coalesce(cbs.credit_balance_cents, 0) as credit_balance_cents
from public.clients c
left join public.client_insurance_policies cip on cip.client_id = c.id
left join public.client_diagnoses cd on cd.client_id = c.id
left join public.treatment_plans tp on tp.client_id = c.id
left join public.client_balance_summaries cbs on cbs.client_id = c.id
group by c.id, cbs.open_balance_cents, cbs.credit_balance_cents;

create or replace view public.v_client_billing_readiness
with (security_invoker = true)
as
select
  c.tenant_id,
  c.id as client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  c.client_status,
  c.registration_status,
  exists (
    select 1 from public.client_insurance_policies cip
    where cip.client_id = c.id
      and cip.status = 'active'
      and cip.insurance_order = 'primary'
      and coalesce(cip.effective_date, '1900-01-01'::date) <= current_date
      and coalesce(cip.termination_date, '9999-12-31'::date) >= current_date
  ) as has_active_primary_insurance,
  exists (
    select 1 from public.client_diagnoses cd
    where cd.client_id = c.id and cd.diagnosis_status = 'active'
  ) as has_active_diagnosis,
  exists (
    select 1 from public.treatment_plans tp
    where tp.client_id = c.id and tp.status in ('active', 'signed')
  ) as has_active_treatment_plan,
  exists (
    select 1 from public.clinical_notes cn
    where cn.client_id = c.id and cn.note_status = 'signed'
  ) as has_signed_note,
  case
    when not exists (
      select 1 from public.client_insurance_policies cip
      where cip.client_id = c.id and cip.status = 'active' and cip.insurance_order = 'primary'
    ) then 'missing_insurance'
    when not exists (
      select 1 from public.client_diagnoses cd
      where cd.client_id = c.id and cd.diagnosis_status = 'active'
    ) then 'missing_diagnosis'
    when not exists (
      select 1 from public.treatment_plans tp
      where tp.client_id = c.id and tp.status in ('active', 'signed')
    ) then 'not_ready'
    else 'ready_for_charge'
  end::public.billing_readiness_status_enum as calculated_billing_readiness_status,
  c.billing_readiness_status as stored_billing_readiness_status,
  c.updated_at
from public.clients c;

create or replace view public.v_upcoming_appointments
with (security_invoker = true)
as
select
  a.tenant_id,
  a.id as appointment_id,
  a.starts_at,
  a.ends_at,
  a.appointment_status,
  a.location_type,
  a.cpt_code,
  a.service_type,
  a.client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  a.provider_id,
  trim(p.first_name || ' ' || p.last_name) as provider_name,
  ci.on_my_way_at,
  ci.arrived_at,
  ci.checked_in_at,
  exists (select 1 from public.clinical_notes cn where cn.appointment_id = a.id) as has_note,
  exists (select 1 from public.charge_capture_items ch where ch.appointment_id = a.id) as has_charge
from public.appointments a
join public.clients c on c.id = a.client_id
left join public.providers p on p.id = a.provider_id
left join public.client_checkins ci on ci.appointment_id = a.id
where a.starts_at >= (now() - interval '1 day')
  and a.appointment_status not in ('cancelled', 'rescheduled');


revoke all on public.v_client_profile_summary, public.v_client_billing_readiness, public.v_upcoming_appointments from public, anon;
grant select on public.v_client_profile_summary, public.v_client_billing_readiness, public.v_upcoming_appointments to authenticated;
alter table public.mue_limits add column if not exists adjudication_indicator text;
notify pgrst, 'reload schema';
