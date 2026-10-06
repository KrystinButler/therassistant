-- Connect CPT/HCPCS fee schedules and revenue-cycle service lines to the canonical code library.
-- This migration is intentionally additive/non-destructive: existing text code columns remain
-- the API-compatible keys while foreign keys prevent future drift.

-- Backfill any CPT/HCPCS codes already represented in the reference fee-rate library.
insert into public.cpt_codes (
  code,
  display_name,
  is_active,
  label_source,
  metadata
)
select distinct
  upper(trim(r.code)) as code,
  upper(trim(r.code)) as display_name,
  true as is_active,
  'reference_fee_rate_backfill' as label_source,
  jsonb_build_object(
    'code_system', 'CPT_HCPCS',
    'backfilled_from', 'reference_fee_rates'
  ) as metadata
from public.reference_fee_rates r
where nullif(trim(r.code), '') is not null
  and not exists (
    select 1
    from public.cpt_codes c
    where c.code = upper(trim(r.code))
  );

-- Normalize existing fee schedule code keys before enforcing relationships.
update public.reference_fee_rates
set code = upper(trim(code))
where code is distinct from upper(trim(code));

update public.fee_schedule_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is distinct from upper(trim(cpt_code));

-- Revenue-cycle workflow tables use the same canonical code key.
update public.appointments
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.clinical_notes
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.encounter_service_lines
set cpt_hcpcs_code = upper(trim(cpt_hcpcs_code))
where cpt_hcpcs_code is not null
  and cpt_hcpcs_code is distinct from upper(trim(cpt_hcpcs_code));

update public.charge_capture_items
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.professional_claim_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.eligibility_benefits
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

update public.era_service_lines
set cpt_code = upper(trim(cpt_code))
where cpt_code is not null
  and cpt_code is distinct from upper(trim(cpt_code));

-- Enforce one canonical CPT/HCPCS vocabulary across fee schedules and the revenue cycle.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reference_fee_rates_code_fkey') then
    alter table public.reference_fee_rates
      add constraint reference_fee_rates_code_fkey
      foreign key (code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fee_schedule_lines_cpt_code_fkey') then
    alter table public.fee_schedule_lines
      add constraint fee_schedule_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'appointments_cpt_code_fkey') then
    alter table public.appointments
      add constraint appointments_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'clinical_notes_cpt_code_fkey') then
    alter table public.clinical_notes
      add constraint clinical_notes_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'encounter_service_lines_cpt_hcpcs_code_fkey') then
    alter table public.encounter_service_lines
      add constraint encounter_service_lines_cpt_hcpcs_code_fkey
      foreign key (cpt_hcpcs_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'charge_capture_items_cpt_code_fkey') then
    alter table public.charge_capture_items
      add constraint charge_capture_items_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'professional_claim_lines_cpt_code_fkey') then
    alter table public.professional_claim_lines
      add constraint professional_claim_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'eligibility_benefits_cpt_code_fkey') then
    alter table public.eligibility_benefits
      add constraint eligibility_benefits_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'era_service_lines_cpt_code_fkey') then
    alter table public.era_service_lines
      add constraint era_service_lines_cpt_code_fkey
      foreign key (cpt_code) references public.cpt_codes(code)
      on update cascade on delete restrict;
  end if;
end
$$;

-- Index the fee-rate lookup keys used by pricing and reimbursement comparison paths.
create index if not exists idx_reference_fee_rates_code
  on public.reference_fee_rates(code);

create index if not exists idx_fee_schedule_lines_cpt_code
  on public.fee_schedule_lines(cpt_code);
