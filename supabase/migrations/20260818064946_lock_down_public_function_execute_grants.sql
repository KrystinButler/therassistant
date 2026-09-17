-- Tighten public function execution grants.
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default unless revoked.
-- Revoke broad PUBLIC/anon access, then grant only intended app RPCs to authenticated.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- Core tenant / setup RPCs
grant execute on function public.bootstrap_tenant_for_user(text, public.tenant_type_enum, text, text, text) to authenticated;
grant execute on function public.assert_tenant_access(uuid) to authenticated;
grant execute on function public.setup_tenant_rcm_defaults(uuid) to authenticated;
grant execute on function public.validate_tenant_setup(uuid) to authenticated;

grant execute on function public.upsert_provider(uuid, text, text, text, text, text, text, text, public.provider_status_enum) to authenticated;
grant execute on function public.upsert_provider_enrollment(uuid, uuid, text, public.provider_enrollment_status_enum, text, date, date, text) to authenticated;
grant execute on function public.upsert_fee_schedule_rate(uuid, text, text, integer, text, date, text, text) to authenticated;

-- Charge / claim / RCM workflow RPCs
grant execute on function public.create_workqueue_item(uuid, public.workqueue_type_enum, public.workqueue_source_object_type_enum, uuid, text, text, public.workqueue_priority_enum, date, uuid) to authenticated;
grant execute on function public.create_charge_from_appointment(uuid, integer, text, text, text) to authenticated;
grant execute on function public.validate_charge(uuid) to authenticated;
grant execute on function public.create_claim_from_charge(uuid) to authenticated;
grant execute on function public.validate_claim(uuid) to authenticated;
grant execute on function public.create_claim_batch(uuid, text, integer) to authenticated;
grant execute on function public.classify_denial_from_carc(text) to authenticated;
grant execute on function public.create_denial_from_claim(uuid, text, text, integer, text) to authenticated;

-- Ledger / posting RPCs
grant execute on function public.ensure_default_ledger_accounts(uuid) to authenticated;
grant execute on function public.create_ledger_transaction(uuid, text, uuid, text, jsonb, date) to authenticated;
grant execute on function public.post_claim_charge_to_ledger(uuid) to authenticated;
grant execute on function public.post_insurance_payment(uuid, integer, date, public.payment_method_enum, text, text, text) to authenticated;
grant execute on function public.post_patient_payment(uuid, uuid, integer, uuid, date, public.payment_method_enum, text, text) to authenticated;
grant execute on function public.post_adjustment(public.adjustment_type_enum, integer, uuid, uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.post_historical_transaction(uuid, uuid, public.historical_transaction_type_enum, integer, date, uuid, uuid, text, text) to authenticated;
grant execute on function public.recalculate_client_balance_summary(uuid) to authenticated;
grant execute on function public.recalculate_claim_balance_summary(uuid) to authenticated;

-- Patient data entry RPCs
grant execute on function public.create_client_profile(uuid, text, text, date, text, text, text, text, text, text, text, text, text, public.registration_status_enum, public.client_status_enum, jsonb) to authenticated;
grant execute on function public.update_client_profile(uuid, text, text, date, text, text, text, text, text, text, text, text, text, public.registration_status_enum, public.client_status_enum, jsonb) to authenticated;
grant execute on function public.upsert_client_contact(uuid, text, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.resolve_payer_reference(text) to authenticated;
grant execute on function public.upsert_client_insurance_policy(uuid, text, text, public.insurance_order_enum, text, text, text, date, text, date, date, public.insurance_policy_status_enum, jsonb) to authenticated;
grant execute on function public.record_eligibility_check(uuid, date, text, uuid, public.eligibility_status_enum, text, text, jsonb) to authenticated;
grant execute on function public.record_eligibility_benefit(uuid, text, text, text, integer, numeric, integer, integer, boolean, text) to authenticated;
grant execute on function public.upsert_client_diagnosis(uuid, text, text, public.diagnosis_status_enum, date, date) to authenticated;
grant execute on function public.create_treatment_plan_with_goal(uuid, uuid, date, date, text, text, text) to authenticated;
grant execute on function public.create_client_appointment(uuid, uuid, uuid, timestamptz, timestamptz, text, text, public.appointment_location_type_enum, text) to authenticated;
grant execute on function public.record_client_checkin(uuid, text, jsonb) to authenticated;
grant execute on function public.create_clinical_note_for_appointment(uuid, public.clinical_note_type_enum, text, text, text, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.sign_clinical_note(uuid, text, boolean, integer, text) to authenticated;
