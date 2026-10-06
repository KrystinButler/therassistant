begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $test$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000002';
  v_client uuid := '40000000-0000-4000-8000-000000000002';
  v_provider uuid := '20000000-0000-4000-8000-000000000001';
  v_payer uuid := '30000000-0000-4000-8000-000000000001';
  v_policy uuid;
  v_encounter uuid := gen_random_uuid();
  v_charge uuid := gen_random_uuid();
  v_claim uuid;
begin
  select id into strict v_policy from public.client_insurance_policies
  where tenant_id=v_tenant and client_id=v_client and payer_id=v_payer limit 1;
  insert into public.encounters(id, tenant_id, client_id, provider_id, payer_id, insurance_policy_id, billing_status)
  values(v_encounter, v_tenant, v_client, v_provider, v_payer, v_policy, 'charged');
  insert into public.encounter_diagnoses(tenant_id, encounter_id, diagnosis_code, sequence_number, is_primary, present_on_claim)
  values(v_tenant, v_encounter, 'F41.1', 1, true, true);
  insert into public.charge_capture_items(id, tenant_id, client_id, provider_id, payer_id, encounter_id,
    service_date, cpt_code, diagnosis_code, place_of_service, units, charge_amount_cents, charge_status)
  values(v_charge, v_tenant, v_client, v_provider, v_payer, v_encounter, current_date, '90837', 'F41.1', '11', 1, 15000, 'ready_for_claim');
  v_claim := (public.rcm_create_claim_from_charges(v_tenant, array[v_charge])->>'claim_id')::uuid;
  if not exists(select 1 from public.professional_claims where id=v_claim and metadata->>'insurance_policy_id'=v_policy::text) then
    raise exception 'Claim did not retain the encounter insurance policy';
  end if;
end;
$test$;
rollback;
