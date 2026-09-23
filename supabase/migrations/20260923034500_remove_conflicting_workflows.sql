-- Remove obsolete parallel workflows and anonymous demo access paths.
-- Canonical production paths remain:
--   patient intake: create_patient_intake
--   claims: rcm_create_claim_from_charges / rcm_validate_claim / rcm_create_claim_batch
--   mailroom: transition_mailroom_item / get_mailroom_assignees
--   payments: post_manual_payment / post_era_payment_receipt / post_contractual_adjustment / reverse_payment
--   clinical documentation: application repository/workflow + clinical_note_signatures
--   treatment reviews: treatment_plan_review_drafts + treatment_plan_review_signatures

drop table if exists public.payment_desk_transactions restrict;
drop table if exists public.payment_desk_users restrict;

drop function if exists public.create_claim_batch(uuid,text,integer) restrict;
drop function if exists public.create_claim_from_charge(uuid) restrict;
drop function if exists public.validate_claim(uuid) restrict;

drop function if exists public.transition_demo_mailroom_item(uuid,text,text) restrict;
drop function if exists public.get_demo_mailroom_assignees() restrict;

drop function if exists public.create_charge_from_appointment(uuid,integer,text,text,text) restrict;
drop function if exists public.create_clinical_note_for_appointment(
  uuid,public.clinical_note_type_enum,text,text,text,uuid,timestamptz,timestamptz,text
) restrict;
drop function if exists public.sign_clinical_note(uuid,text,boolean,integer,text) restrict;
drop function if exists public.create_treatment_plan_with_goal(uuid,uuid,date,date,text,text,text) restrict;

drop function if exists public.create_client_profile(
  uuid,text,text,date,text,text,text,text,text,text,text,text,text,
  public.registration_status_enum,public.client_status_enum,jsonb
) restrict;

drop function if exists public.create_denial_from_claim(uuid,text,text,integer,text) restrict;
drop function if exists public.update_client_profile(
  uuid,text,text,date,text,text,text,text,text,text,text,text,text,
  public.registration_status_enum,public.client_status_enum,jsonb
) restrict;

drop function if exists public.create_client_appointment(
  uuid,uuid,uuid,timestamptz,timestamptz,text,text,public.appointment_location_type_enum,text
) restrict;

drop function if exists public.post_demo_manual_payment(
  bigint,public.payment_source_enum,public.payment_method_enum,uuid,uuid,uuid,bigint,text,text,text
) restrict;
drop function if exists public.reverse_demo_payment(uuid,text) restrict;
drop function if exists public.post_patient_payment(
  uuid,uuid,integer,uuid,date,public.payment_method_enum,text,text
) restrict;
drop function if exists public.post_insurance_payment(
  uuid,integer,date,public.payment_method_enum,text,text,text
) restrict;
drop function if exists public.post_adjustment(
  public.adjustment_type_enum,integer,uuid,uuid,uuid,uuid,text,text,date
) restrict;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and policyname ilike '%demo%'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      p.policyname, p.schemaname, p.tablename
    );
  end loop;
end;
$$;
