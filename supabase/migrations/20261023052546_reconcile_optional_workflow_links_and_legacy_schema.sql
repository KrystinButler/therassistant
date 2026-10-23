-- Align optional workflow references with the canonical application schema.
-- Draft validation and tenant/RLS checks remain in their owning workflows.
-- No rows or relationships are removed; non-null UUIDs still require valid FK targets.
alter table public."appointments" alter column "provider_id" drop not null;
alter table public."charge_capture_items" alter column "appointment_id" drop not null;
alter table public."charge_capture_items" alter column "clinical_note_id" drop not null;
alter table public."charge_capture_items" alter column "provider_id" drop not null;
alter table public."claim_submissions" alter column "batch_id" drop not null;
alter table public."denials" alter column "claim_id" drop not null;
alter table public."denials" alter column "client_id" drop not null;
alter table public."denials" alter column "payer_id" drop not null;
alter table public."document_history" alter column "actor_id" drop not null;
alter table public."encounter_service_lines" alter column "place_of_service_code" drop not null;
alter table public."encounters" alter column "provider_id" drop not null;
alter table public."era_claims" alter column "claim_id" drop not null;
alter table public."era_claims" alter column "client_id" drop not null;
alter table public."era_files" alter column "payer_id" drop not null;
alter table public."professional_claims" alter column "billing_provider_id" drop not null;
alter table public."professional_claims" alter column "charge_id" drop not null;
alter table public."professional_claims" alter column "payer_id" drop not null;
alter table public."professional_claims" alter column "rendering_provider_id" drop not null;

-- Retain legacy integration aliases in reproducible schema history.
-- Canonical columns remain the application write targets; existing values are untouched.
alter table public."claim_diagnoses" add column if not exists "Appointment" uuid;
alter table public."claim_status_history" add column if not exists "Client" uuid;
alter table public."claim_status_history" add column if not exists "Encounter" uuid;
alter table public."claim_status_history" add column if not exists "appointment" uuid;
alter table public."claim_submissions" add column if not exists "Encounter" uuid;
alter table public."claim_submissions" add column if not exists "client" uuid;
alter table public."client_balance_summaries" add column if not exists "appointment" uuid;
alter table public."client_balance_summaries" add column if not exists "charge" uuid;
alter table public."client_balance_summaries" add column if not exists "claim" uuid;
alter table public."client_balance_summaries" add column if not exists "location" uuid;
alter table public."client_balance_summaries" add column if not exists "provider" uuid;
alter table public."client_diagnoses" add column if not exists "Encounter_Id" uuid;
alter table public."client_diagnoses" add column if not exists "plan" uuid;
alter table public."clinical_note_signatures" add column if not exists "Encounter_Id" uuid;
alter table public."clinical_note_signatures" add column if not exists "User_id" uuid;
alter table public."credentialing_application_events" add column if not exists "Provder_Id" uuid;
alter table public."credentialing_applications" add column if not exists "provider_id" uuid;
alter table public."denials" add column if not exists "Encounter_Id" uuid;
alter table public."eligibility_benefits" add column if not exists "Insurance" uuid;
alter table public."encounter_diagnoses" add column if not exists "Patient" uuid;
alter table public."encounters" add column if not exists "User_id" uuid;
alter table public."encounters" add column if not exists "location" uuid;
alter table public."historical_transaction_allocations" add column if not exists "client" uuid;
alter table public."providers" add column if not exists "User" uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_diagnoses'::regclass and conname='claim_diagnoses_Appointment_fkey') then
    alter table public."claim_diagnoses" add constraint "claim_diagnoses_Appointment_fkey" FOREIGN KEY ("Appointment") REFERENCES appointments(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_status_history'::regclass and conname='claim_status_history_Client_fkey') then
    alter table public."claim_status_history" add constraint "claim_status_history_Client_fkey" FOREIGN KEY ("Client") REFERENCES clients(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_status_history'::regclass and conname='claim_status_history_Encounter_fkey') then
    alter table public."claim_status_history" add constraint "claim_status_history_Encounter_fkey" FOREIGN KEY ("Encounter") REFERENCES encounters(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_status_history'::regclass and conname='claim_status_history_appointment_fkey') then
    alter table public."claim_status_history" add constraint "claim_status_history_appointment_fkey" FOREIGN KEY (appointment) REFERENCES appointments(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_submissions'::regclass and conname='claim_submissions_Encounter_fkey') then
    alter table public."claim_submissions" add constraint "claim_submissions_Encounter_fkey" FOREIGN KEY ("Encounter") REFERENCES encounters(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.claim_submissions'::regclass and conname='claim_submissions_client_fkey') then
    alter table public."claim_submissions" add constraint "claim_submissions_client_fkey" FOREIGN KEY (client) REFERENCES clients(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_balance_summaries'::regclass and conname='client_balance_summaries_appointment_fkey') then
    alter table public."client_balance_summaries" add constraint "client_balance_summaries_appointment_fkey" FOREIGN KEY (appointment) REFERENCES appointments(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_balance_summaries'::regclass and conname='client_balance_summaries_charge_fkey') then
    alter table public."client_balance_summaries" add constraint "client_balance_summaries_charge_fkey" FOREIGN KEY (charge) REFERENCES charge_capture_items(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_balance_summaries'::regclass and conname='client_balance_summaries_claim_fkey') then
    alter table public."client_balance_summaries" add constraint "client_balance_summaries_claim_fkey" FOREIGN KEY (claim) REFERENCES claim_batch_items(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_balance_summaries'::regclass and conname='client_balance_summaries_location_fkey') then
    alter table public."client_balance_summaries" add constraint "client_balance_summaries_location_fkey" FOREIGN KEY (location) REFERENCES provider_locations(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_balance_summaries'::regclass and conname='client_balance_summaries_provider_fkey') then
    alter table public."client_balance_summaries" add constraint "client_balance_summaries_provider_fkey" FOREIGN KEY (provider) REFERENCES providers(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_diagnoses'::regclass and conname='client_diagnoses_Encounter_Id_fkey') then
    alter table public."client_diagnoses" add constraint "client_diagnoses_Encounter_Id_fkey" FOREIGN KEY ("Encounter_Id") REFERENCES encounters(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_diagnoses'::regclass and conname='client_diagnoses_plan_fkey') then
    alter table public."client_diagnoses" add constraint "client_diagnoses_plan_fkey" FOREIGN KEY (plan) REFERENCES treatment_plans(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.clinical_note_signatures'::regclass and conname='clinical_note_signatures_Encounter_Id_fkey') then
    alter table public."clinical_note_signatures" add constraint "clinical_note_signatures_Encounter_Id_fkey" FOREIGN KEY ("Encounter_Id") REFERENCES encounters(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.clinical_note_signatures'::regclass and conname='clinical_note_signatures_User_id_fkey') then
    alter table public."clinical_note_signatures" add constraint "clinical_note_signatures_User_id_fkey" FOREIGN KEY ("User_id") REFERENCES tenant_users(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.credentialing_application_events'::regclass and conname='credentialing_application_events_Provder_Id_fkey') then
    alter table public."credentialing_application_events" add constraint "credentialing_application_events_Provder_Id_fkey" FOREIGN KEY ("Provder_Id") REFERENCES providers(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.credentialing_applications'::regclass and conname='credentialing_applications_provider_id_fkey') then
    alter table public."credentialing_applications" add constraint "credentialing_applications_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES providers(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.denials'::regclass and conname='denials_Encounter_Id_fkey') then
    alter table public."denials" add constraint "denials_Encounter_Id_fkey" FOREIGN KEY ("Encounter_Id") REFERENCES encounters(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.eligibility_benefits'::regclass and conname='eligibility_benefits_Insurance_fkey') then
    alter table public."eligibility_benefits" add constraint "eligibility_benefits_Insurance_fkey" FOREIGN KEY ("Insurance") REFERENCES client_insurance_policies(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.encounter_diagnoses'::regclass and conname='encounter_diagnoses_Patient_fkey') then
    alter table public."encounter_diagnoses" add constraint "encounter_diagnoses_Patient_fkey" FOREIGN KEY ("Patient") REFERENCES clients(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.encounters'::regclass and conname='encounters_User_id_fkey') then
    alter table public."encounters" add constraint "encounters_User_id_fkey" FOREIGN KEY ("User_id") REFERENCES tenant_users(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.encounters'::regclass and conname='encounters_location_fkey') then
    alter table public."encounters" add constraint "encounters_location_fkey" FOREIGN KEY (location) REFERENCES provider_locations(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.historical_transaction_allocations'::regclass and conname='historical_transaction_allocations_client_fkey') then
    alter table public."historical_transaction_allocations" add constraint "historical_transaction_allocations_client_fkey" FOREIGN KEY (client) REFERENCES clients(id);
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.providers'::regclass and conname='providers_User_fkey') then
    alter table public."providers" add constraint "providers_User_fkey" FOREIGN KEY ("User") REFERENCES user_profiles(id);
  end if;
end $$;

notify pgrst, 'reload schema';
