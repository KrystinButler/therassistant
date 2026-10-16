begin;
do $$
declare t uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); n uuid:=gen_random_uuid(); n2 uuid:=gen_random_uuid(); r jsonb; submitted jsonb; draft jsonb; payload jsonb; flag boolean:=false;
begin
 insert into public.tenants(id,name) values(t,'SYNTHETIC INTAKE QA');
 insert into public.providers(id,tenant_id,first_name,last_name,telehealth_url) values(p,t,'SYNTHETIC','PROVIDER','https://doxy.me/therassistant');
 insert into public.practice_entities(tenant_id,legal_name,status) values(t,'SYNTHETIC QA','active');
 insert into public.practice_locations(tenant_id,name,practice_entity_id,status) select t,'SYNTHETIC QA',id,'active' from public.practice_entities where tenant_id=t;
 insert into public.clients(id,tenant_id,first_name,last_name) values(c,t,'SYNTHETIC','INTAKE QA');
 insert into public.appointments(id,tenant_id,client_id,provider_id,starts_at,ends_at,location_type) values(a,t,c,p,now()+interval '1 day',now()+interval '1 day 1 hour','telehealth');
 if (select telehealth_url from public.appointments where id=a) is distinct from 'https://doxy.me/therassistant' then raise exception 'Provider video inheritance failed'; end if;
 insert into auth.users(id,email) values(u,'ehr-intake-qa-'||u||'@example.invalid');
 insert into public.client_portal_access(tenant_id,client_id,user_id,invited_email,status) values(t,c,u,'ehr-intake-qa-'||u||'@example.invalid','active');
 perform set_config('request.jwt.claim.sub',u::text,true);
 draft:=jsonb_build_object('demographics_confirmed',true,'insurance_confirmed',true,
   'visit_questions',jsonb_build_object('focus_today','Synthetic focus','screeners',jsonb_build_object('phq9',jsonb_build_array(1,1,1,1,1,1,1,1,1),'gad7',jsonb_build_array(0,0,0,0,0,0,0),'cssrs',jsonb_build_array(false,false,null,null,null,false,null))),
   'consents',jsonb_build_object('information_accurate',true,'privacy_acknowledged',true,'care_acknowledged',true),'expected_updated_at',null);
 r:=public.portal_save_previsit_checkin(a,draft);
 if (select count(*) from public.workqueue_items where tenant_id=t and source_object_id=a and title='Patient screening safety review')<>1 then raise exception 'Saved draft safety task failed'; end if;
 begin
  perform public.portal_save_previsit_checkin(a,jsonb_build_object('visit_questions',jsonb_build_object('focus_today','Stale'),'expected_updated_at',null));
 exception when serialization_failure then flag:=true; end;
 if not flag then raise exception 'Stale save was not rejected'; end if;
 insert into public.clinical_notes(id,tenant_id,client_id,provider_id,appointment_id,note_text) values(n,t,c,p,a,'Provider authored text');
 draft:=draft||jsonb_build_object('submitted',true,'expected_updated_at',r #>> '{responses,pre_visit,updated_at}');
 submitted:=public.portal_save_previsit_checkin(a,draft);
 select portal_intake into payload from public.clinical_notes where id=n;
 if payload->>'phq9_total' is distinct from '9' or payload->>'gad7_total' is distinct from '0' or payload->>'focus_today' is distinct from 'Synthetic focus' then raise exception 'Discrete clinical import failed'; end if;
 if (select note_text from public.clinical_notes where id=n) is distinct from 'Provider authored text' then raise exception 'Provider content changed'; end if;
 r:=public.portal_save_previsit_checkin(a,draft);
 if r #>> '{responses,pre_visit,submitted_at}' is distinct from submitted #>> '{responses,pre_visit,submitted_at}' then raise exception 'Retry changed submitted timestamp'; end if;
 if (select count(*) from public.clinical_outcome_measures where tenant_id=t and source_reference_id=a)<>2 then raise exception 'Screening rows duplicated'; end if;
 flag:=false;
 begin
  perform public.portal_save_previsit_checkin(a,jsonb_build_object('visit_questions',jsonb_build_object('focus_today','Changed')));
 exception when raise_exception then flag:=true; end;
 if not flag then raise exception 'Submitted answers were mutable'; end if;
 insert into public.clinical_notes(id,tenant_id,client_id,provider_id,appointment_id,note_text) values(n2,t,c,p,a,'Later draft');
 if (select portal_intake->>'phq9_total' from public.clinical_notes where id=n2) is distinct from '9' then raise exception 'Late note hydration failed'; end if;
 if private.portal_screener_score('[null,0,0,0,0,0,0,0,0]'::jsonb,9) is not null then raise exception 'Missing answer became zero'; end if;
end; $$;
rollback;
select 'PASS: video inheritance, draft safety task, stale-save rejection, discrete note import, provider-text preservation, idempotent retry, immutable submission, late-note hydration, missing-score handling; all synthetic writes rolled back' as result;
