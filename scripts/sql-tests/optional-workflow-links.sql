-- Run only in isolated CI/replay. Every synthetic row is rolled back.
begin;
do $$
declare
  v_entity uuid; v_tenant uuid; v_client uuid; v_era uuid; v_claim uuid; v_charge uuid;
begin
  insert into public.tenants(name,status) values ('Schema contract fixture','active') returning id into v_tenant;
  insert into public.practice_entities(tenant_id,legal_name,status) values(v_tenant,'Schema fixture','active') returning id into v_entity;
  insert into public.practice_locations(tenant_id,practice_entity_id,name,status) values(v_tenant,v_entity,'Schema fixture','active');
  insert into public.providers(tenant_id,first_name,last_name) values(v_tenant,'Schema','Fixture');
  insert into public.clients(tenant_id,first_name,last_name) values(v_tenant,'Schema','Fixture') returning id into v_client;
  -- Payer and claim/client matching happen after an 835 is parsed.
  insert into public.era_files(tenant_id,file_name) values(v_tenant,'unmatched-fixture.835') returning id into v_era;
  insert into public.era_claims(tenant_id,era_file_id,status) values(v_tenant,v_era,'unmatched');
  -- Direct documentation has no appointment; imported/draft charges may await note/provider resolution.
  insert into public.charge_capture_items(tenant_id,client_id,service_date,cpt_code)
    values(v_tenant,v_client,current_date,'90837') returning id into v_charge;
  -- Drafts are validated by the claim workflow before they are eligible for submission.
  insert into public.professional_claims(tenant_id,client_id) values(v_tenant,v_client) returning id into v_claim;
  if not exists(select 1 from public.era_claims where era_file_id=v_era and claim_id is null and client_id is null) then
    raise exception 'Unmatched ERA lost its unresolved links';
  end if;
  if not exists(select 1 from public.charge_capture_items where id=v_charge and appointment_id is null) then
    raise exception 'Appointment-free charge was not retained';
  end if;
  -- Optional does not permit broken non-null references.
  begin
    update public.charge_capture_items set appointment_id=gen_random_uuid() where id=v_charge;
    raise exception 'Invalid appointment reference was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
rollback;
