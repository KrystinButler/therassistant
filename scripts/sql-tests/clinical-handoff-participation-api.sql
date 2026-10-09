begin;
select set_config('test.participation.admin',(select id::text from auth.users where email='staff.e2e@example.test'),true);
select set_config('test.participation.clinician',(select id::text from auth.users where email='jamie.parker@example.test'),true);
-- Valid isolated catalog selection for request and retry checks.
update public.payer_plans set state='CO',active=true,effective_from=null,effective_to=null where id='31000000-0000-4000-8000-000000000001';
update public.payers set active=true,effective_from=null,effective_to=null where id='30000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub',current_setting('test.participation.admin'),true);
set local role authenticated;
do $$ declare a jsonb; b jsonb; begin
 a:=public.request_participation_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
 b:=public.request_participation_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
 if a->>'verificationId' is distinct from b->>'verificationId' or a->>'status'<>'IN_PROGRESS' then raise exception 'Request retry not idempotent'; end if;
 perform set_config('test.participation.run',a->>'verificationId',true);
 begin
 perform public.request_participation_verification(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
 raise exception 'Cross-tenant request accepted';
 exception when insufficient_privilege then null; end;
 begin
 perform public.request_participation_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',gen_random_uuid());
 raise exception 'Invalid plan accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.participation.clinician'),true);
do $$ begin
 begin
 perform public.request_participation_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
 raise exception 'Clinician without credentialing access queued verification';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from pgmq.q_credentialing_participation_verification where message->>'runId'=current_setting('test.participation.run'))<>1 then raise exception 'Request did not enqueue exactly once'; end if;
end $$;
rollback;
