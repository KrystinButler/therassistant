create or replace function private.default_appointment_video() returns trigger language plpgsql security invoker set search_path = '' as $$
declare old_default text;
begin
 if tg_op='UPDATE' and new.provider_id is distinct from old.provider_id then
  select p.telehealth_url into old_default from public.providers p where p.id=old.provider_id and p.tenant_id=old.tenant_id;
  if new.telehealth_url is not distinct from old.telehealth_url and new.telehealth_url=old_default then new.telehealth_url:=null; end if;
 end if;
 if new.location_type='telehealth' and nullif(btrim(new.telehealth_url),'') is null then
  select p.telehealth_url into new.telehealth_url from public.providers p where p.id=new.provider_id and p.tenant_id=new.tenant_id;
 end if;
 return new;
end; $$;
create or replace function private.sync_portal_screeners() returns trigger language plpgsql security definer set search_path = '' as $$
declare
 v jsonb; a public.appointments%rowtype; tz text; assessed date; key text; instrument_name text; answers jsonb; n integer; total integer; safety jsonb;
begin
 if nullif(new.responses #>> '{pre_visit,submitted_at}','') is null then return new; end if;
 v:=new.responses #> '{pre_visit,visit_questions,screeners}';
 if v is null or v->>'declined'='true' then return new; end if;
 select * into a from public.appointments where id=new.appointment_id and tenant_id=new.tenant_id and client_id=new.client_id;
 if not found then raise exception 'Screening appointment does not match patient'; end if;
 select timezone into tz from public.tenants where id=new.tenant_id;
 assessed:=((new.responses #>> '{pre_visit,submitted_at}')::timestamptz at time zone tz)::date;
 foreach key in array array['phq9','gad7'] loop
  answers:=v->key; n:=case key when 'phq9' then 9 else 7 end; instrument_name:=case key when 'phq9' then 'PHQ-9' else 'GAD-7' end;
  if jsonb_typeof(answers) is distinct from 'array' then raise exception 'Screening answers are required'; end if;
  if jsonb_array_length(answers)<>n or exists(select 1 from jsonb_array_elements(answers) x where jsonb_typeof(x) is distinct from 'number' or x::text !~ '^[0-3]$') then raise exception 'Complete all screening answers using values 0 to 3'; end if;
  select sum(x::text::integer) into total from jsonb_array_elements(answers) x;
  insert into public.clinical_outcome_measures(tenant_id,client_id,provider_id,instrument,score,assessed_on,source,notes,source_reference_id)
  values(new.tenant_id,new.client_id,a.provider_id,instrument_name,total,assessed,'patient_reported','Patient portal questionnaire answers: '||answers::text,new.appointment_id)
  on conflict(tenant_id,instrument,source_reference_id) where source_reference_id is not null do update set score=excluded.score,notes=excluded.notes,assessed_on=excluded.assessed_on,updated_at=now();
 end loop;
 safety:=v->'cssrs';
 if jsonb_typeof(safety) is distinct from 'array' then raise exception 'Safety screening answers are required'; end if;
 if jsonb_array_length(safety)<>7 or jsonb_typeof(safety->0) is distinct from 'boolean' or jsonb_typeof(safety->1) is distinct from 'boolean' or jsonb_typeof(safety->5) is distinct from 'boolean' then raise exception 'Complete safety screening answers'; end if;
 if safety->>1='true' and (jsonb_typeof(safety->2) is distinct from 'boolean' or jsonb_typeof(safety->3) is distinct from 'boolean' or jsonb_typeof(safety->4) is distinct from 'boolean') then raise exception 'Complete safety screening follow-up'; end if;
 if safety->>5='true' and jsonb_typeof(safety->6) is distinct from 'boolean' then raise exception 'Complete safety screening time frame'; end if;
 insert into public.clinical_safety_screenings(tenant_id,client_id,provider_id,instrument,score_text,risk_level,assessed_on,source,narrative,source_reference_id)
 values(new.tenant_id,new.client_id,a.provider_id,'C-SSRS','Patient responses; clinician review required',null,assessed,'patient_reported','C-SSRS Recent self-report. Items 1–5 past month; item 6 lifetime; item 7 past 3 months. Answers: '||safety::text||'. No clinician risk classification or intervention is documented by this submission.',new.appointment_id)
 on conflict(tenant_id,instrument,source_reference_id) where source_reference_id is not null do update set score_text=excluded.score_text,narrative=excluded.narrative,assessed_on=excluded.assessed_on,updated_at=now();
 if (v->'phq9'->>8)::integer>0 or exists(select 1 from jsonb_array_elements(safety) x where x='true'::jsonb) then
  if not exists(select 1 from public.workqueue_items where tenant_id=new.tenant_id and source_object_id=new.appointment_id and title='Patient screening safety review' and workqueue_status in ('open','in_progress','pending')) then
   insert into public.workqueue_items(tenant_id,workqueue_type,source_object_type,source_object_id,title,description,priority)
   values(new.tenant_id,'general_task','appointment',new.appointment_id,'Patient screening safety review','Patient endorsed a safety-related screening answer. Review the submitted questionnaire and contact the patient through the clinical workflow. No risk classification or completed safety intervention is implied.','high');
  end if;
 end if;
 return new;
end; $$;
