-- Explicit administrative identity assignment; no automatic role grants or real-user links.
create policy provider_user_links_admin_select on public.provider_user_links
for select to authenticated using (private.has_tenant_admin_access(tenant_id));

create or replace function public.validate_provider_user_link()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_admin boolean;
begin
  v_admin := private.has_tenant_admin_access(new.tenant_id);
  if auth.uid() is null or (new.user_id <> auth.uid() and not v_admin) then
    raise exception 'Only the clinician or a practice administrator may manage this link' using errcode='42501';
  end if;
  if not private.has_tenant_write_access(new.tenant_id) then
    raise exception 'Practice access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.tenant_users u join public.tenant_user_roles r
    on r.tenant_id=u.tenant_id and r.user_id=u.user_id
    where u.tenant_id=new.tenant_id and u.user_id=new.user_id
      and u.status::text='active' and r.role::text='clinician') then
    raise exception 'An active clinician membership is required' using errcode='42501';
  end if;
  if not exists (select 1 from public.providers p where p.id=new.provider_id
    and p.tenant_id=new.tenant_id and p.provider_status='active') then
    raise exception 'Active provider not found in this practice' using errcode='22023';
  end if;
  if not v_admin and not exists (select 1 from public.providers p join public.user_profiles u
    on lower(p.email::text)=lower(u.email::text)
    where p.id=new.provider_id and u.id=new.user_id) then
    raise exception 'Ask a practice administrator to confirm your rendering provider assignment' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function private.admin_link_clinician_provider_impl(p_tenant_id uuid,p_user_id uuid,p_provider_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.provider_user_links%rowtype;
begin
  if auth.uid() is null or not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;
  -- Serialize assignments in this tenant, and never silently replace an identity.
  perform 1 from public.tenants where id=p_tenant_id for update;
  if exists (select 1 from public.provider_user_links where tenant_id=p_tenant_id
    and ((provider_id=p_provider_id and user_id<>p_user_id) or (user_id=p_user_id and provider_id<>p_provider_id))) then
    raise exception 'This provider or clinician already has a different assignment. Resolve that assignment before linking.' using errcode='22023';
  end if;
  insert into public.provider_user_links(tenant_id,provider_id,user_id,status)
  values(p_tenant_id,p_provider_id,p_user_id,'active')
  on conflict (tenant_id,provider_id) do update set status='active',updated_at=now()
  returning * into v_link;
  insert into public.audit_logs(tenant_id,actor_id,action,target_type,target_id,new_values,metadata)
  values(p_tenant_id,auth.uid(),'clinician_provider_link_confirmed','provider_user_link',v_link.id::text,
    jsonb_build_object('user_id',p_user_id,'provider_id',p_provider_id),'{}'::jsonb);
  return jsonb_build_object('linked',true,'provider_id',p_provider_id,'user_id',p_user_id);
end $$;
revoke all on function private.admin_link_clinician_provider_impl(uuid,uuid,uuid) from public,anon;
grant execute on function private.admin_link_clinician_provider_impl(uuid,uuid,uuid) to authenticated;
create or replace function public.admin_link_clinician_provider(p_tenant_id uuid,p_user_id uuid,p_provider_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_link_clinician_provider_impl(p_tenant_id,p_user_id,p_provider_id);
$$;
revoke all on function public.admin_link_clinician_provider(uuid,uuid,uuid) from public,anon;
grant execute on function public.admin_link_clinician_provider(uuid,uuid,uuid) to authenticated;

create or replace function public.clinician_signing_readiness(p_provider_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p public.providers%rowtype; v_role boolean; v_link boolean; v_match boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into p from public.providers where id=p_provider_id;
 if not found or not private.has_tenant_read_access(p.tenant_id) then
   return jsonb_build_object('can_sign',false,'reason','provider_required');
 end if;
 select exists(select 1 from public.tenant_user_roles where tenant_id=p.tenant_id and user_id=auth.uid() and role::text='clinician') into v_role;
 select exists(select 1 from public.provider_user_links where tenant_id=p.tenant_id and provider_id=p.id and user_id=auth.uid() and status='active') into v_link;
 select exists(select 1 from public.user_profiles where id=auth.uid() and lower(email::text)=lower(p.email::text)) into v_match;
 return jsonb_build_object('can_sign',v_role and v_link and p.provider_status='active' and private.has_tenant_write_access(p.tenant_id),
   'reason',case when p.provider_status<>'active' then 'provider_inactive' when not v_role then 'clinician_role_required'
     when not v_link and not v_match then 'email_mismatch' when not v_link then 'provider_not_linked' else 'ready' end,
   'email_match',v_match,'provider_id',p.id);
end $$;
revoke all on function public.clinician_signing_readiness(uuid) from public,anon;
grant execute on function public.clinician_signing_readiness(uuid) to authenticated;
