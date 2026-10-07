-- Synthetic identities only; replayed inside isolated CI and always rolled back.
begin;
-- A failed handoff write must roll back the signature and the locking trigger.
create function private.test_clinical_handoff_failure() returns trigger language plpgsql as $$
begin
  if new.title='Clinical billing handoff' and new.source_object_id='e9000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Synthetic handoff storage failure';
  end if;
  return new;
end;
$$;
create trigger test_clinical_handoff_failure before insert on public.workqueue_items
for each row execute function private.test_clinical_handoff_failure();
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='jamie.parker@example.test'), true);
select set_config('test.clinical_provider_user', (select id::text from auth.users where email='jamie.parker@example.test'), true);
select set_config('test.clinical_staff_user', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $test$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000002';
  v_client uuid := '40000000-0000-4000-8000-000000000002';
  v_provider uuid := '20000000-0000-4000-8000-000000000001';
  v_encounter uuid := gen_random_uuid();
  v_note uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_result jsonb;
  v_first_signed_at timestamptz;
  v_denied boolean := false;
  v_failed_note uuid := gen_random_uuid();
  v_failed_encounter uuid := 'e9000000-0000-4000-8000-000000000001';
  v_unsigned_note uuid := gen_random_uuid();
begin
  insert into public.encounters(id,tenant_id,client_id,provider_id)
  values(v_failed_encounter,v_tenant,v_client,v_provider);
  insert into public.clinical_notes(id,tenant_id,encounter_id,client_id,provider_id,note_type,note_text,service_date)
  values(v_failed_note,v_tenant,v_failed_encounter,v_client,v_provider,'assessment','Synthetic rollback test',current_date-1);
  begin
    perform public.sign_encounter_note(v_failed_encounter,v_failed_note,v_provider,'Uncoded synthetic signature');
    raise exception 'Uncoded visit was signed';
  exception when invalid_parameter_value then null;
  end;
  insert into public.encounter_diagnoses(tenant_id,encounter_id,diagnosis_code,sequence_number,is_primary,present_on_claim)
  values(v_tenant,v_failed_encounter,'F41.1',1,true,true);
  insert into public.encounter_service_lines(tenant_id,encounter_id,cpt_hcpcs_code,units,charge_amount_cents,place_of_service_code)
  values(v_tenant,v_failed_encounter,'90791',1,15000,'02');
  begin
    perform public.sign_encounter_note(v_failed_encounter,v_failed_note,v_provider,'Synthetic signature');
  exception when raise_exception then
    if sqlerrm <> 'Synthetic handoff storage failure' then raise; end if;
    v_denied := true;
  end;
  if not v_denied or exists(select 1 from public.clinical_note_signatures where clinical_note_id=v_failed_note)
    or not exists(select 1 from public.clinical_notes where id=v_failed_note and note_status='draft' and locked_at is null)
    or not exists(select 1 from public.encounters where id=v_failed_encounter and encounter_status='in_progress') then
    raise exception 'Failed handoff write left a partial clinical signature';
  end if;
  v_denied := false;
  insert into public.encounters(id,tenant_id,client_id,provider_id)
  values(v_encounter,v_tenant,v_client,v_provider);
  insert into public.clinical_notes(id,tenant_id,encounter_id,client_id,provider_id,note_type,note_text,service_date)
  values(v_note,v_tenant,v_encounter,v_client,v_provider,'assessment','Synthetic clinical documentation',current_date-1);
  -- Even a direct signature writer must leave durable work in the same transaction.
  insert into public.clinical_note_signatures(tenant_id,clinical_note_id,signer_id,provider_id,signature_text)
  values(v_tenant,v_note,auth.uid(),v_provider,'Synthetic clinician');
  if not exists(select 1 from public.workqueue_items where tenant_id=v_tenant
    and source_object_type='encounter' and source_object_id=v_encounter
    and workqueue_type='general_task' and title='Clinical billing handoff' and workqueue_status='open') then
    raise exception 'Signed note has no durable billing handoff';
  end if;
  if not exists(select 1 from public.clinical_notes where id=v_note and note_status='signed' and locked_at is not null) then
    raise exception 'Signature did not lock the note';
  end if;
  select signed_at into v_first_signed_at from public.clinical_note_signatures where clinical_note_id=v_note;
  v_result := public.sign_encounter_note(v_encounter,v_note,v_provider,'Retry signature');
  if (v_result->>'signed_at')::timestamptz is distinct from v_first_signed_at
    or (select count(*) from public.clinical_note_signatures where clinical_note_id=v_note) <> 1
    or (select count(*) from public.workqueue_items where source_object_id=v_encounter and title='Clinical billing handoff') <> 1 then
    raise exception 'Signing retry duplicated or replaced durable signature/handoff';
  end if;
  -- Missing service lines must not falsely complete the pending handoff.
  if public.complete_clinical_billing_handoff(v_encounter) then
    raise exception 'Incomplete handoff was marked complete';
  end if;
  insert into public.encounter_service_lines(id,tenant_id,encounter_id,cpt_hcpcs_code,units,charge_amount_cents,place_of_service_code)
  values(v_line,v_tenant,v_encounter,'90791',1,15000,'11');
  update public.encounters set billing_status='charged' where id=v_encounter;
  if public.complete_clinical_billing_handoff(v_encounter) then
    raise exception 'Encounter status alone completed a handoff with no charge';
  end if;
  insert into public.charge_capture_items(tenant_id,encounter_id,service_line_id,clinical_note_id,client_id,provider_id,service_date,cpt_code,units,charge_amount_cents,charge_status)
  values(v_tenant,v_encounter,v_line,v_note,v_client,v_provider,current_date,'90791',1,15000,'ready_for_claim');
  if not public.complete_clinical_billing_handoff(v_encounter) then
    raise exception 'Complete charge coverage did not resolve pending work';
  end if;
  perform public.sign_encounter_note(v_encounter,v_note,v_provider,'Later retry');
  if exists(select 1 from public.workqueue_items where source_object_id=v_encounter and title='Clinical billing handoff' and workqueue_status <> 'completed') then
    raise exception 'Signing retry reopened completed billing work';
  end if;
  -- Administrative membership does not authorize signing.
  insert into public.clinical_notes(id,tenant_id,encounter_id,client_id,provider_id,note_type,note_text,service_date)
  values(v_unsigned_note,v_tenant,v_encounter,v_client,v_provider,'assessment','Unsigned synthetic note',current_date-1);
  perform set_config('request.jwt.claim.sub',current_setting('test.clinical_staff_user'),true);
  begin
    perform public.sign_encounter_note(v_encounter,v_note,v_provider,'Unauthorized signature');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Non-clinician signed a clinical note'; end if;
  v_denied := false;
  begin
    insert into public.clinical_note_signatures(tenant_id,clinical_note_id,signer_id,provider_id,signature_text)
    values(v_tenant,v_unsigned_note,auth.uid(),v_provider,'Unauthorized direct signature');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or not exists(select 1 from public.clinical_notes where id=v_unsigned_note and note_status='draft') then
    raise exception 'Direct signature write bypassed clinician authorization';
  end if;
  perform set_config('request.jwt.claim.sub',current_setting('test.clinical_provider_user'),true);
  update public.provider_user_links set status='inactive' where provider_id=v_provider and user_id=auth.uid();
  v_denied := false;
  begin
    perform public.sign_encounter_note(v_encounter,v_note,v_provider,'Inactive provider link');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Inactive provider link authorized signing'; end if;
end;
$test$;
rollback;
