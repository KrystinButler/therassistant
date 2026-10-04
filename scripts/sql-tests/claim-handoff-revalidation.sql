begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $test$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000002';
  v_client uuid := '40000000-0000-4000-8000-000000000002';
  v_provider uuid := '20000000-0000-4000-8000-000000000001';
  v_payer uuid := '30000000-0000-4000-8000-000000000001';
  v_encounter uuid := gen_random_uuid();
  v_charge uuid := gen_random_uuid();
  v_claim uuid;
  v_result jsonb;
begin
  update public.provider_payer_enrollments set enrollment_status='needs_revalidation'
  where tenant_id=v_tenant and provider_id=v_provider and payer_id=v_payer;
  if not found then raise exception 'Synthetic provider enrollment is missing'; end if;
  insert into public.encounters(id, tenant_id, client_id, provider_id, payer_id, billing_status)
  values(v_encounter, v_tenant, v_client, v_provider, v_payer, 'charged');
  insert into public.encounter_diagnoses(tenant_id, encounter_id, diagnosis_code, sequence_number, is_primary, present_on_claim)
  values(v_tenant, v_encounter, 'F41.1', 1, true, true);
  insert into public.charge_capture_items(id, tenant_id, client_id, provider_id, payer_id, encounter_id,
    service_date, cpt_code, diagnosis_code, place_of_service, units, charge_amount_cents, charge_status)
  values(v_charge, v_tenant, v_client, v_provider, v_payer, v_encounter, current_date, '90837', 'F41.1', '11', 1, 15000, 'ready_for_claim');
  v_claim := (public.rcm_create_claim_from_charges(v_tenant, array[v_charge])->>'claim_id')::uuid;
  v_result := public.rcm_validate_claim(v_claim);
  if not coalesce((v_result->>'valid')::boolean, false) then
    raise exception 'Revalidation advisory incorrectly rejects a claim: %', v_result;
  end if;
end;
$test$;
rollback;
