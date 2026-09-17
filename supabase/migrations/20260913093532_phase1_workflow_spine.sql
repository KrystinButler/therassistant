begin;

create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_id uuid unique references public.appointments(id),
  client_id uuid not null references public.clients(id),
  provider_id uuid references public.providers(id),
  insurance_policy_id uuid references public.client_insurance_policies(id),
  payer_id uuid references public.payers(id),
  encounter_status text not null default 'in_progress'
    check (encounter_status in ('in_progress','completed','ready_for_billing','billing_hold','closed','voided')),
  billing_status text not null default 'not_ready'
    check (billing_status in ('not_ready','ready','held','charged','claimed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  location_type text,
  service_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.encounter_diagnoses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  diagnosis_code text not null,
  diagnosis_description text,
  is_primary boolean not null default false,
  sequence_number integer not null default 1 check (sequence_number > 0),
  present_on_claim boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (encounter_id, diagnosis_code)
);

create table if not exists public.encounter_service_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  cpt_hcpcs_code text not null,
  modifier1 text,
  modifier2 text,
  units numeric not null default 1 check (units > 0),
  charge_amount_cents bigint not null default 0 check (charge_amount_cents >= 0),
  place_of_service_code text,
  ready_for_claim boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.encounter_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  check_code text not null,
  check_status text not null check (check_status in ('pass','warn','fail')),
  blocking boolean not null default false,
  message text not null,
  action text,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (encounter_id, check_code)
);

alter table public.clinical_notes
  add column if not exists encounter_id uuid references public.encounters(id);

alter table public.charge_capture_items
  add column if not exists encounter_id uuid references public.encounters(id);

alter table public.professional_claims
  add column if not exists source_encounter_id uuid references public.encounters(id);

create index if not exists encounters_tenant_client_idx
  on public.encounters(tenant_id, client_id);
create index if not exists encounters_appointment_idx
  on public.encounters(appointment_id);
create index if not exists encounters_provider_idx
  on public.encounters(tenant_id, provider_id);
create index if not exists encounter_diagnoses_encounter_idx
  on public.encounter_diagnoses(encounter_id, sequence_number);
create index if not exists encounter_service_lines_encounter_idx
  on public.encounter_service_lines(encounter_id);
create index if not exists encounter_readiness_checks_encounter_idx
  on public.encounter_readiness_checks(encounter_id, blocking);
create index if not exists clinical_notes_encounter_idx
  on public.clinical_notes(encounter_id);
create index if not exists charge_capture_items_encounter_idx
  on public.charge_capture_items(encounter_id);
create index if not exists professional_claims_source_encounter_idx
  on public.professional_claims(source_encounter_id);

alter table public.encounters enable row level security;
alter table public.encounter_diagnoses enable row level security;
alter table public.encounter_service_lines enable row level security;
alter table public.encounter_readiness_checks enable row level security;

drop policy if exists "demo anon read encounters" on public.encounters;
create policy "demo anon read encounters"
  on public.encounters for select to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon insert encounters" on public.encounters;
create policy "demo anon insert encounters"
  on public.encounters for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon update encounters" on public.encounters;
create policy "demo anon update encounters"
  on public.encounters for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon read encounter diagnoses" on public.encounter_diagnoses;
create policy "demo anon read encounter diagnoses"
  on public.encounter_diagnoses for select to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon insert encounter diagnoses" on public.encounter_diagnoses;
create policy "demo anon insert encounter diagnoses"
  on public.encounter_diagnoses for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon update encounter diagnoses" on public.encounter_diagnoses;
create policy "demo anon update encounter diagnoses"
  on public.encounter_diagnoses for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon read encounter service lines" on public.encounter_service_lines;
create policy "demo anon read encounter service lines"
  on public.encounter_service_lines for select to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon insert encounter service lines" on public.encounter_service_lines;
create policy "demo anon insert encounter service lines"
  on public.encounter_service_lines for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon update encounter service lines" on public.encounter_service_lines;
create policy "demo anon update encounter service lines"
  on public.encounter_service_lines for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon read encounter readiness" on public.encounter_readiness_checks;
create policy "demo anon read encounter readiness"
  on public.encounter_readiness_checks for select to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon insert encounter readiness" on public.encounter_readiness_checks;
create policy "demo anon insert encounter readiness"
  on public.encounter_readiness_checks for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));
drop policy if exists "demo anon update encounter readiness" on public.encounter_readiness_checks;
create policy "demo anon update encounter readiness"
  on public.encounter_readiness_checks for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

grant select, insert, update on public.encounters to anon;
grant select, insert, update on public.encounter_diagnoses to anon;
grant select, insert, update on public.encounter_service_lines to anon;
grant select, insert, update on public.encounter_readiness_checks to anon;

commit;
