begin;
-- A separate synthetic payer is installed before switching to the staff role.
insert into public.payers(id, name, payer_type)
values('30000000-0000-4000-8000-000000000099', 'Correction test payer', 'commercial');
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $test$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000002';
  v_client uuid := '40000000-0000-4000-8000-000000000002';
  v_provider uuid := '20000000-0000-4000-8000-000000000001';
  v_payer uuid := '30000000-0000-4000-8000-000000000001';
  v_new_payer uuid := '30000000-0000-4000-8000-000000000099';
  v_new_client uuid := gen_random_uuid();
  v_original_policy uuid;
  v_patient_policy uuid := gen_random_uuid();
  v_payer_policy uuid := gen_random_uuid();
  v_encounter uuid := gen_random_uuid();
  v_charge uuid := gen_random_uuid();
  v_claim uuid;
  v_request uuid := gen_random_uuid();
  v_bad_request uuid := gen_random_uuid();
  v_values jsonb;
  v_result jsonb;
begin
  select id into strict v_original_policy from public.client_insurance_policies
    where tenant_id=v_tenant and client_id=v_client and payer_id=v_payer limit 1;
  insert into public.clients(id, tenant_id, first_name, last_name)
    values(v_new_client, v_tenant, 'Synthetic', 'Correction');
  insert into public.client_insurance_policies(id, tenant_id, client_id, payer_id, member_id, status, insurance_order)
    values(v_patient_policy, v_tenant, v_new_client, v_payer, 'CORRECTED-PATIENT', 'active', 'primary'),
          (v_payer_policy, v_tenant, v_new_client, v_new_payer, 'CORRECTED-PAYER', 'active', 'primary');
  insert into public.client_insurance_policies(tenant_id, client_id, payer_id, member_id, status, insurance_order, created_at)
    values(v_tenant, v_new_client, v_payer, 'INACTIVE-COVERAGE', 'inactive', 'primary', now()+interval '1 second');
  insert into public.encounters(id, tenant_id, client_id, provider_id, payer_id, insurance_policy_id, billing_status)
    values(v_encounter, v_tenant, v_client, v_provider, v_payer, v_original_policy, 'charged');
  insert into public.encounter_diagnoses(tenant_id, encounter_id, diagnosis_code, sequence_number, is_primary, present_on_claim)
    values(v_tenant, v_encounter, 'F41.1', 1, true, true);
  insert into public.charge_capture_items(id, tenant_id, client_id, provider_id, payer_id, encounter_id,
    service_date, cpt_code, diagnosis_code, place_of_service, units, charge_amount_cents, charge_status)
    values(v_charge, v_tenant, v_client, v_provider, v_payer, v_encounter,
      current_date, '90837', 'F41.1', '11', 1, 15000, 'ready_for_claim');
  v_claim := (public.rcm_create_claim_from_charges(v_tenant, array[v_charge])->>'claim_id')::uuid;

  -- The UPDATE used by saveClaimIdentityFields must replace the old snapshot.
  update public.professional_claims set client_id=v_new_client where id=v_claim;
  if not exists(select 1 from public.professional_claims where id=v_claim
    and metadata->>'insurance_policy_id'=v_patient_policy::text) then
    raise exception 'Patient correction did not capture matching insurance';
  end if;
  -- Unrelated metadata and source documentation must remain intact.
  if not exists(select 1 from public.professional_claims where id=v_claim
    and source_encounter_id=v_encounter and metadata->>'source'='encounter_charge') then
    raise exception 'Correction lost claim provenance';
  end if;

  -- The atomic RPC must synchronize a payer change in the same transaction.
  select to_jsonb(c) into v_values from public.professional_claims c where id=v_claim;
  v_values := v_values || jsonb_build_object('payer_id',v_new_payer);
  v_result := public.rcm_save_rejection_corrections(v_claim,v_request,v_values,'[]','[]',false);
  if not exists(select 1 from public.professional_claims where id=v_claim
    and metadata->>'insurance_policy_id'=v_payer_policy::text) then
    raise exception 'Atomic payer correction did not capture matching insurance';
  end if;
  v_result := public.rcm_save_rejection_corrections(v_claim,v_request,v_values,'[]','[]',false);
  if not (v_result->>'replayed')::boolean then raise exception 'Correction retry was not replayed'; end if;

  -- Missing coverage must fail before any identity change is persisted.
  begin
    update public.professional_claims set client_id=v_client where id=v_claim;
    raise exception 'Missing correction coverage was accepted';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Select matching insurance coverage%' then raise; end if;
  end;
  if not exists(select 1 from public.professional_claims where id=v_claim
    and client_id=v_new_client and payer_id=v_new_payer
    and metadata->>'insurance_policy_id'=v_payer_policy::text) then
    raise exception 'Failed correction partially changed claim identity';
  end if;
  begin
    perform public.rcm_save_rejection_corrections(v_claim,v_bad_request,
      v_values || jsonb_build_object('client_id',v_client),'[]','[]',false);
    raise exception 'Atomic correction accepted missing coverage';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Select matching insurance coverage%' then raise; end if;
  end;
  if exists(select 1 from public.claim_correction_requests where request_id=v_bad_request) then
    raise exception 'Failed correction left a retry request behind';
  end if;

  -- Same-identity saves preserve the selected policy even if newer coverage exists.
  insert into public.client_insurance_policies(tenant_id, client_id, payer_id, member_id, status, insurance_order, created_at)
    values(v_tenant, v_new_client, v_new_payer, 'NEWER-COVERAGE', 'active', 'primary', now()+interval '1 second');
  update public.professional_claims set client_id=v_new_client, payer_id=v_new_payer where id=v_claim;
  if not exists(select 1 from public.professional_claims where id=v_claim
    and metadata->>'insurance_policy_id'=v_payer_policy::text) then
    raise exception 'Same-identity save replaced the captured policy';
  end if;

  update public.professional_claims set payer_id=null where id=v_claim;
  if exists(select 1 from public.professional_claims where id=v_claim
    and metadata ? 'insurance_policy_id') then
    raise exception 'Removing a payer retained stale captured coverage';
  end if;
end;
$test$;
rollback;
