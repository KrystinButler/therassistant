-- Make claim-level 837 lineage explicit to a specific active insurance policy.
alter table public.professional_claims
  add column if not exists insurance_policy_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='professional_claims_insurance_policy_id_fkey') then
    alter table public.professional_claims
      add constraint professional_claims_insurance_policy_id_fkey
      foreign key (insurance_policy_id) references public.client_insurance_policies(id) on delete set null;
  end if;
end $$;
create index if not exists idx_professional_claims_insurance_policy_id on public.professional_claims(insurance_policy_id);

-- Snapshot the exact provider/location/policy/claim control context used at submission time.
alter table public.claim_submissions
  add column if not exists encounter_id uuid,
  add column if not exists client_id uuid,
  add column if not exists practice_entity_id uuid,
  add column if not exists provider_location_id uuid,
  add column if not exists insurance_policy_id uuid,
  add column if not exists patient_control_number text,
  add column if not exists payer_control_number text,
  add column if not exists edi_interchange_control_number text,
  add column if not exists edi_group_control_number text,
  add column if not exists edi_transaction_control_number text,
  add column if not exists x12_version text,
  add column if not exists transaction_set_type text,
  add column if not exists x12_snapshot jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='claim_submissions_encounter_id_fkey') then
    alter table public.claim_submissions add constraint claim_submissions_encounter_id_fkey
      foreign key (encounter_id) references public.encounters(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='claim_submissions_client_id_fkey') then
    alter table public.claim_submissions add constraint claim_submissions_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='claim_submissions_practice_entity_id_fkey') then
    alter table public.claim_submissions add constraint claim_submissions_practice_entity_id_fkey
      foreign key (practice_entity_id) references public.practice_entities(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='claim_submissions_provider_location_id_fkey') then
    alter table public.claim_submissions add constraint claim_submissions_provider_location_id_fkey
      foreign key (provider_location_id) references public.provider_locations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='claim_submissions_insurance_policy_id_fkey') then
    alter table public.claim_submissions add constraint claim_submissions_insurance_policy_id_fkey
      foreign key (insurance_policy_id) references public.client_insurance_policies(id) on delete set null;
  end if;
end $$;

create index if not exists idx_claim_submissions_encounter_id on public.claim_submissions(encounter_id);
create index if not exists idx_claim_submissions_client_id on public.claim_submissions(client_id);
create index if not exists idx_claim_submissions_practice_entity_id on public.claim_submissions(practice_entity_id);
create index if not exists idx_claim_submissions_provider_location_id on public.claim_submissions(provider_location_id);
create index if not exists idx_claim_submissions_insurance_policy_id on public.claim_submissions(insurance_policy_id);
create index if not exists idx_claim_submissions_patient_control_number on public.claim_submissions(patient_control_number);
create index if not exists idx_claim_submissions_payer_control_number on public.claim_submissions(payer_control_number);

-- Seed submission snapshot/context from the linked professional claim.
update public.claim_submissions cs
   set encounter_id = pc.source_encounter_id,
       client_id = pc.client_id,
       insurance_policy_id = pc.insurance_policy_id,
       patient_control_number = pc.patient_control_number,
       payer_control_number = coalesce(cs.payer_control_number, pc.payer_control_number),
       x12_version = coalesce(cs.x12_version, '005010X222A1'),
       transaction_set_type = coalesce(cs.transaction_set_type, '837P'),
       x12_snapshot = coalesce(cs.x12_snapshot, jsonb_build_object(
         'claim_id', pc.id,
         'patient_control_number', pc.patient_control_number,
         'payer_id', pc.payer_id,
         'billing_provider_name', pc.billing_provider_name,
         'billing_provider_npi', pc.billing_provider_npi,
         'rendering_provider_name', pc.rendering_provider_name,
         'rendering_provider_npi', pc.rendering_provider_npi,
         'service_facility_name', pc.service_facility_name,
         'service_facility_npi', pc.service_facility_npi,
         'total_charge_cents', pc.total_charge_cents
       ))
  from public.professional_claims pc
 where cs.claim_id = pc.id
   and (
     cs.encounter_id is null
     or cs.client_id is null
     or cs.insurance_policy_id is null
     or cs.patient_control_number is null
     or cs.x12_version is null
     or cs.transaction_set_type is null
     or cs.x12_snapshot is null
   );

-- Backfill provider/practice context through encounter -> provider location -> practice location.
update public.claim_submissions cs
   set provider_location_id = e.location
  from public.encounters e
 where cs.encounter_id = e.id
   and cs.provider_location_id is null
   and e.location is not null;

update public.claim_submissions cs
   set practice_entity_id = pl.practice_entity_id
  from public.provider_locations vpl
  join public.practice_locations pl on pl.id = vpl.practice_location_id
 where cs.provider_location_id = vpl.id
   and cs.practice_entity_id is null;