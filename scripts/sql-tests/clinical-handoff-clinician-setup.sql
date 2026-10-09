-- Isolated CI identities only; roll back every assignment.
begin;
select set_config('test.setup.clinician',(select id::text from auth.users where email='jamie.parker@example.test'),true);
select set_config('test.setup.admin',(select id::text from auth.users where email='staff.e2e@example.test'),true);
delete from public.provider_user_links where tenant_id='10000000-0000-4000-8000-000000000002';
update public.providers set email='different-login@example.test' where id='20000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub',current_setting('test.setup.clinician'),true);
set local role authenticated;
do $$ begin
 if (public.clinician_signing_readiness('20000000-0000-4000-8000-000000000001')->>'can_sign')::boolean then raise exception 'Unlinked clinician is ready'; end if;
 begin
  perform public.admin_link_clinician_provider('10000000-0000-4000-8000-000000000002',auth.uid(),'20000000-0000-4000-8000-000000000001');
  raise exception 'Non-admin assigned a provider';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.setup.admin'),true);
do $$ begin
 begin
  perform public.admin_link_clinician_provider('10000000-0000-4000-8000-000000000002',auth.uid(),'20000000-0000-4000-8000-000000000001');
  raise exception 'Admin-only user became a signer';
 exception when insufficient_privilege then null; end;
 perform public.admin_link_clinician_provider('10000000-0000-4000-8000-000000000002',current_setting('test.setup.clinician')::uuid,'20000000-0000-4000-8000-000000000001');
 perform public.admin_link_clinician_provider('10000000-0000-4000-8000-000000000002',current_setting('test.setup.clinician')::uuid,'20000000-0000-4000-8000-000000000001');
 if not exists(select 1 from public.audit_logs where action='clinician_provider_link_confirmed' and actor_id=auth.uid()) then raise exception 'Assignment was not audited'; end if;
 begin
  perform public.admin_link_clinician_provider(gen_random_uuid(),current_setting('test.setup.clinician')::uuid,'20000000-0000-4000-8000-000000000001');
  raise exception 'Cross-tenant link allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.setup.clinician'),true);
do $$ begin
 if not (public.clinician_signing_readiness('20000000-0000-4000-8000-000000000001')->>'can_sign')::boolean then raise exception 'Assigned clinician is not ready'; end if;
end $$;
rollback;
