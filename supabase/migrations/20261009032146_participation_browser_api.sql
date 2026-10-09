-- Browser entry point to the existing server-only verification queue.
create or replace function private.request_participation_verification_impl(
 p_tenant_id uuid,p_provider_id uuid,p_payer_id uuid,p_plan_id uuid,
 p_network_id uuid default null,p_organization_id uuid default null,p_practice_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) or not exists (
   select 1 from public.tenant_users u join public.tenant_user_roles r on r.tenant_id=u.tenant_id and r.user_id=u.user_id
   where u.tenant_id=p_tenant_id and u.user_id=auth.uid() and u.status::text='active'
   and r.role::text in ('platform_admin','practice_admin','billing_company_admin','credentialing_specialist')) then
   raise exception 'Credentialing access required' using errcode='42501';
 end if;
 if not exists(select 1 from public.providers where id=p_provider_id and tenant_id=p_tenant_id and individual_npi ~ '^[0-9]{10}$') then
   raise exception 'Select a provider in this practice with a valid individual NPI' using errcode='22023';
 end if;
 if not exists(select 1 from public.payer_plans pp join public.payers p on p.id=pp.payer_id
   where pp.id=p_plan_id and p.id=p_payer_id and pp.state='CO' and pp.active and p.active
   and (pp.effective_from is null or pp.effective_from<=current_date) and (pp.effective_to is null or pp.effective_to>=current_date)
   and (p.effective_from is null or p.effective_from<=current_date) and (p.effective_to is null or p.effective_to>=current_date)) then
   raise exception 'Select an active Colorado plan for this payer' using errcode='22023';
 end if;
 if p_network_id is not null and not exists(select 1 from public.payer_networks where id=p_network_id and plan_id=p_plan_id and active
   and (effective_from is null or effective_from<=current_date) and (effective_to is null or effective_to>=current_date)) then
   raise exception 'Network does not belong to the active plan' using errcode='22023';
 end if;
 if p_organization_id is not null and not exists(select 1 from public.practice_entities where id=p_organization_id and tenant_id=p_tenant_id) then
   raise exception 'Organization is outside this practice' using errcode='22023';
 end if;
 if p_practice_location_id is not null and not exists(select 1 from public.practice_locations where id=p_practice_location_id and tenant_id=p_tenant_id
   and (p_organization_id is null or practice_entity_id=p_organization_id)) then
   raise exception 'Location is outside the selected practice entity' using errcode='22023';
 end if;
 perform 1 from public.tenants where id=p_tenant_id for update;
 select id into v_id from public.participation_verification_runs where tenant_id=p_tenant_id and provider_id=p_provider_id
   and payer_id=p_payer_id and plan_id=p_plan_id and network_id is not distinct from p_network_id
   and organization_id is not distinct from p_organization_id and practice_location_id is not distinct from p_practice_location_id
   and status='IN_PROGRESS' and requested_at>now()-interval '10 minutes' order by requested_at desc limit 1;
 if v_id is null then
   insert into public.participation_verification_runs(tenant_id,provider_id,payer_id,plan_id,network_id,organization_id,practice_location_id,created_by_user_id)
   values(p_tenant_id,p_provider_id,p_payer_id,p_plan_id,p_network_id,p_organization_id,p_practice_location_id,auth.uid()) returning id into v_id;
   perform pgmq.send('credentialing_participation_verification',jsonb_build_object('runId',v_id,'tenantId',p_tenant_id));
   insert into public.audit_logs(tenant_id,actor_id,action,target_type,target_id,metadata)
   values(p_tenant_id,auth.uid(),'VERIFICATION_REQUESTED','participation_verification_run',v_id::text,jsonb_build_object('provider_id',p_provider_id,'payer_id',p_payer_id,'plan_id',p_plan_id));
 end if;
 return jsonb_build_object('verificationId',v_id,'status','IN_PROGRESS');
end $$;
revoke all on function private.request_participation_verification_impl(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function private.request_participation_verification_impl(uuid,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;
create or replace function public.request_participation_verification(
 p_tenant_id uuid,p_provider_id uuid,p_payer_id uuid,p_plan_id uuid,
 p_network_id uuid default null,p_organization_id uuid default null,p_practice_location_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.request_participation_verification_impl(p_tenant_id,p_provider_id,p_payer_id,p_plan_id,p_network_id,p_organization_id,p_practice_location_id);
$$;
revoke all on function public.request_participation_verification(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.request_participation_verification(uuid,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;
