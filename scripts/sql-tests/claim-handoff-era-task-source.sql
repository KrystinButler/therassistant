-- CI-only fixture: verify staff can retain two remittance exception tasks independently.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $test$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000002';
  v_file uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_count integer;
begin
  insert into public.era_files(id, tenant_id, file_name)
  values(v_file, v_tenant, 'exact-remittance-fixture.835');
  insert into public.era_claims(id, tenant_id, era_file_id, patient_control_number)
  values(v_first, v_tenant, v_file, 'SYNTHETIC-ONE'),
        (v_second, v_tenant, v_file, 'SYNTHETIC-TWO');
  insert into public.workqueue_items(tenant_id, workqueue_type, source_object_type, source_object_id, title)
  values(v_tenant, 'unmatched_era', 'era_claim', v_first, 'First remittance exception'),
        (v_tenant, 'unmatched_era', 'era_claim', v_second, 'Second remittance exception');
  select count(*) into v_count from public.workqueue_items w
    join public.era_claims e on e.id=w.source_object_id and e.tenant_id=w.tenant_id
    where w.tenant_id=v_tenant and w.source_object_type='era_claim' and e.era_file_id=v_file;
  if v_count <> 2 then raise exception 'Exact remittance tasks collapsed or could not be read: %', v_count; end if;
end;
$test$;
rollback;
